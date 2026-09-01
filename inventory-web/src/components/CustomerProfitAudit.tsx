import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, TrendingUp, X } from "lucide-react"
import { getCustomerProfitAudit, fixInvoiceLineCost, type AuditGroup } from "../api/endpoints"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"

/* ══════════════════════════════════════════════════════════════════════
   «تدقيق ربح الزبون»

   A product sold before its purchase price was filled in carries a cost of
   zero, and every profit figure downstream reads that sale as pure profit —
   which is the number a discount then gets priced against.

   This screen does not fix anything on its own. It puts the suspicious lines,
   the money involved, and the honest profit side by side, so the merchant can
   correct a cost with the numbers in front of him.
══════════════════════════════════════════════════════════════════════ */

const iqd = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(Number(n)).toLocaleString("en-US")} د.ع`

export function CustomerProfitAudit({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [minMargin, setMinMargin] = useState("30")
  const [applied, setApplied] = useState(30)
  const [fixing, setFixing] = useState<AuditGroup | null>(null)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["customer-profit-audit", customerId, applied],
    queryFn: () => getCustomerProfitAudit({ customerId, minMarginPercent: applied }),
  })

  const t = data?.totals

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-0 sm:p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-4xl rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}>

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">تدقيق الربح — {data?.customer.name ?? "..."}</h2>
            <p className="text-xs text-slate-500">
              ثلاث مجموعات: بلا كلفة إطلاقاً، وكلفة مقدّرة من بطاقة المادة، وربح مسجّل عالي.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isLoading && <p className="py-10 text-center text-sm text-slate-400">جاري الحساب...</p>}
        {isError && <p className="py-10 text-center text-sm text-red-600">{apiErrorMessage(error)}</p>}

        {data && t && (
          <>
            {/* The headline pair: what the reports say, and what is knowable. */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="مبيعاته" value={iqd(t.revenue)} />
              <Tile label="الربح المعروض بالتقارير" value={iqd(t.reportedProfit)} tone="amber" />
              <Tile label="الربح المؤكد" value={iqd(t.knownProfit)} tone="emerald"
                hint={t.knownMarginPercent != null ? `${t.knownMarginPercent}% هامش` : undefined} />
              <Tile
                label={t.revenueNoCost > 0 ? "مبيعات بلا كلفة إطلاقاً" : "مبيعات بكلفة مقدّرة"}
                value={iqd(t.revenueNoCost > 0 ? t.revenueNoCost : t.revenueEstimated)}
                tone={t.revenueNoCost > 0 ? "rose" : "slate"}
                hint={t.revenueNoCost > 0 ? "محسوبة ربح ١٠٠٪ وهي مجهولة" : "الكلفة من بطاقة المادة اليوم"} />
            </div>

            {t.revenueNoCost > 0 && (
              <p className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
                ⚠️ {iqd(t.revenueNoCost)} من مبيعاته بلا سعر شراء بأي مكان — تنحسب ربح ١٠٠٪ وهي مجهولة.
              </p>
            )}
            {t.revenueEstimated > 0 && (
              <p className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                ⚠️ {iqd(t.revenueEstimated)} من مبيعاته كلفتها مأخوذة من بطاقة المادة اليوم، مو من وقت البيع —
                تقريب ممكن يكون بعيد إذا سعر الشراء تغيّر.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              المؤكد من ربحك عند هذا الزبون هو <b>{iqd(t.knownProfit)}</b> — وعلى أساسه احسب خصمك، مو على الرقم المعروض بالتقارير.
            </p>

            <div className="mt-4 flex items-end gap-2">
              <label className="space-y-1">
                <span className="block text-xs font-semibold text-slate-500">اعرض الربح الأعلى من (%)</span>
                <Input type="number" min={0} max={100} value={minMargin} dir="ltr" className="h-9 w-24 text-sm"
                  onChange={(e) => setMinMargin(e.target.value)} />
              </label>
              <Button size="sm" onClick={() => setApplied(Math.max(0, Math.min(100, Number(minMargin) || 0)))}>
                طبّق
              </Button>
            </div>

            <Section
              title="مواد بلا سعر شراء إطلاقاً"
              icon={<AlertTriangle className="h-4 w-4 text-rose-600" />}
              empty="ما اكو ولا مادة بلا كلفة عند هذا الزبون."
              note="هذي محسوبة ربح ١٠٠٪ بالتقارير. أخطر مجموعة."
              groups={data.noCost}
              tone="rose"
              onFix={setFixing}
            />

            <Section
              title="كلفتها مأخوذة من بطاقة المادة اليوم"
              icon={<AlertTriangle className="h-4 w-4 text-slate-500" />}
              empty="ما اكو مادة كلفتها مقدّرة."
              note="السطر انباع بلا كلفة، والتقرير يستعمل كلفة اليوم — تقريب، مو رقم مسجّل وقت البيع."
              groups={data.estimated}
              tone="slate"
              onFix={setFixing}
            />

            <Section
              title={`ربح أعلى من ${data.minMarginPercent}%`}
              icon={<TrendingUp className="h-4 w-4 text-amber-600" />}
              empty="ما اكو مادة فوق هذي النسبة."
              groups={data.highMargin}
              tone="amber"
              onFix={setFixing}
            />
          </>
        )}

        {fixing && (
          <FixCostDialog
            group={fixing}
            customerId={customerId}
            onClose={() => setFixing(null)}
            onDone={() => {
              setFixing(null)
              void qc.invalidateQueries({ queryKey: ["customer-profit-audit"] })
            }}
          />
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, hint, tone = "slate" }: {
  label: string; value: string; hint?: string; tone?: "slate" | "amber" | "emerald" | "rose"
}) {
  const tones = {
    slate: "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    emerald: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    rose: "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
  }
  return (
    <div className={cn("rounded-xl p-3", tones[tone])}>
      <p className="text-[11px] font-semibold opacity-80">{label}</p>
      <p className="mt-0.5 text-sm font-extrabold" dir="ltr">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] opacity-70">{hint}</p>}
    </div>
  )
}

function Section({ title, icon, empty, note, groups, tone, onFix }: {
  title: string
  icon: React.ReactNode
  empty: string
  note?: string
  groups: AuditGroup[]
  tone: "rose" | "amber" | "slate"
  onFix: (g: AuditGroup) => void
}) {
  return (
    <div className="mt-5">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
        {icon}
        {title}
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {groups.length}
        </span>
      </p>
      {note && groups.length > 0 && <p className="mb-1.5 text-[11px] text-slate-500">{note}</p>}
      {groups.length === 0 && <p className="text-xs text-slate-400">{empty}</p>}
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.productId}
            className={cn(
              "rounded-xl border p-3",
              tone === "rose" ? "border-rose-200 bg-rose-50/40 dark:border-rose-900 dark:bg-rose-950/30"
                : tone === "slate" ? "border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40"
                  : "border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/30",
            )}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{g.productName}</p>
                <p className="text-[11px] text-slate-500">
                  {g.itemNumber ?? "—"} · {g.pieces.toLocaleString("en-US")} قطعة · بيع {iqd(g.revenue)}
                </p>
              </div>
              <div className="text-left">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200" dir="ltr">
                  {g.marginPercent == null ? "كلفة مجهولة" : `${g.marginPercent}%`}
                </p>
                <p className="text-[11px] text-slate-500" dir="ltr">
                  {g.costPerPiece > 0 ? `${iqd(g.costPerPiece)} / قطعة` : "بلا كلفة"}
                </p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => onFix(g)}>
                صلّح سعر الشراء
              </Button>
            </div>

            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">
                {g.lines.length} سطر بفواتيره
              </summary>
              <div className="mt-1.5 space-y-1">
                {g.lines.map((l) => (
                  <div key={l.invoiceItemId} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[11px] dark:bg-slate-900">
                    <span className="text-slate-600 dark:text-slate-300">{l.invoiceNumber}</span>
                    <span className="text-slate-400">{new Date(l.date).toLocaleDateString("ar-IQ")}</span>
                    <span className="text-slate-600 dark:text-slate-300">{l.quantity} {UNIT_AR[l.unit] ?? l.unit}</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100" dir="ltr">{iqd(l.revenue)}</span>
                    <span className="text-slate-400" dir="ltr">
                      {l.costPerPiece > 0 ? `${iqd(l.costPerPiece)}/قطعة` : "بلا كلفة"}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  )
}

const UNIT_AR: Record<string, string> = { PIECE: "قطعة", DOZEN: "درزن", BOX: "علبة", CARTON: "كارتون" }

function FixCostDialog({ group, customerId, onClose, onDone }: {
  group: AuditGroup; customerId: string; onClose: () => void; onDone: () => void
}) {
  const [cost, setCost] = useState(
    group.productCostPrice > 0 ? String(group.productCostPrice)
      : group.productPurchasePrice > 0 ? String(group.productPurchasePrice) : "",
  )
  const [scope, setScope] = useState<"INVOICE" | "CUSTOMER" | "ALL">("CUSTOMER")
  const [invoiceItemId, setInvoiceItemId] = useState(group.lines[0]?.invoiceItemId ?? "")
  const [updateProduct, setUpdateProduct] = useState(true)

  const mut = useMutation({
    mutationFn: () => fixInvoiceLineCost({
      productId: group.productId,
      costPerPiece: Number(cost),
      scope,
      invoiceItemId: scope === "INVOICE" ? invoiceItemId : undefined,
      customerId: scope === "CUSTOMER" ? customerId : undefined,
      updateProduct,
    }),
    onSuccess: (r) => {
      toast({
        title: "انصلح سعر الشراء",
        description: `${r.linesUpdated} سطر${r.productUpdated ? " · وانحدّثت بطاقة المادة" : ""}`,
      })
      onDone()
    },
    onError: (e) => toast({ title: apiErrorMessage(e), variant: "destructive" }),
  })

  const valid = Number(cost) > 0 && (scope !== "INVOICE" || Boolean(invoiceItemId))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{group.productName}</p>
        <p className="mt-0.5 text-xs text-slate-500">سعر الشراء للقطعة الواحدة — نفس وحدة النظام.</p>

        <Input type="number" min={0} value={cost} dir="ltr" className="mt-3 text-sm"
          placeholder="سعر شراء القطعة" onChange={(e) => setCost(e.target.value)} />

        <p className="mt-4 text-xs font-semibold text-slate-600 dark:text-slate-300">ينطبق على</p>
        <div className="mt-1.5 space-y-1.5">
          {([
            { v: "INVOICE" as const, label: "هذي الفاتورة بس", desc: "سطر واحد تختاره" },
            { v: "CUSTOMER" as const, label: "كل فواتير هذا الزبون", desc: "أسطر هذي المادة عنده الي بلا كلفة" },
            { v: "ALL" as const, label: "كل الفواتير بالنظام", desc: "أسطر هذي المادة عند كل الزبائن الي بلا كلفة" },
          ]).map((o) => (
            <button key={o.v} type="button" onClick={() => setScope(o.v)}
              className={cn(
                "w-full rounded-xl border-2 p-2.5 text-right transition",
                scope === o.v ? "border-blue-600 bg-blue-50 dark:bg-blue-950" : "border-slate-200 dark:border-slate-700",
              )}>
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{o.label}</p>
              <p className="text-[11px] text-slate-500">{o.desc}</p>
            </button>
          ))}
        </div>

        {scope === "INVOICE" && (
          <select value={invoiceItemId} onChange={(e) => setInvoiceItemId(e.target.value)}
            className="mt-2 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950">
            {group.lines.map((l) => (
              <option key={l.invoiceItemId} value={l.invoiceItemId}>
                {l.invoiceNumber} — {new Date(l.date).toLocaleDateString("ar-IQ")} — {iqd(l.revenue)}
              </option>
            ))}
          </select>
        )}

        <label className="mt-3 flex items-start gap-2">
          <input type="checkbox" checked={updateProduct} onChange={(e) => setUpdateProduct(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-emerald-600" />
          <span>
            <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">حدّث بطاقة المادة هم</span>
            <span className="block text-[11px] text-slate-500">
              حتى البيعة الجاية تنحسب صح من نفسها. بدونه ترجع نفس المشكلة.
            </span>
          </span>
        </label>

        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          يملأ الأسطر الفارغة بس — أي سطر عنده سعر شراء مسجّل ما ينلمس.
          النقاط والفواتير والأرصدة ما تتغير، الي يتغير هو حساب ربحك.
        </p>

        <div className="mt-4 flex gap-2">
          <Button className="flex-1" disabled={!valid || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "جاري التصليح..." : "صلّح"}
          </Button>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
        </div>
      </div>
    </div>
  )
}
