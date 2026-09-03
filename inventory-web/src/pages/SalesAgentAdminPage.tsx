/**
 * «المندوب» — the owner's screen: cash handovers and the commission calculator.
 *
 * Admin-only, and served by a router the rep cannot reach at all. The rep must
 * never see a commission figure, so this is not the rep's page with sections
 * hidden — it is a different page behind a different guard.
 *
 * Two panels, because the owner does two distinct things here:
 *   - take cash off a rep and write it down
 *   - work out what to pay them at the end of a month
 */
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../api/client"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { Card, CardContent } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Button } from "../components/ui/button"

type Liability = {
  agentId: string
  name: string
  username: string
  phone: string | null
  collected: number
  handedOver: number
  onHand: number
}

type Handover = {
  id: string
  agentId: string
  agentName: string
  amount: number
  date: string
  notes: string | null
  receivedBy: string
}

type Commission = {
  agentId: string
  agentName: string
  month: string
  invoiceCount: number
  sold: number
  collected: number
  ratePercent: number | null
  onSold: number | null
  onCollected: number | null
}

const money = (n: number) => Math.round(n).toLocaleString("en-US")

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

export function SalesAgentAdminPage() {
  const qc = useQueryClient()

  const liability = useQuery({
    queryKey: ["sales-agent-admin", "liability"],
    queryFn: async () => {
      const res = await api.get<{ data: Liability[] }>("/sales-agent-admin/liability")
      return res.data.data ?? []
    },
    retry: 3,
  })

  const handovers = useQuery({
    queryKey: ["sales-agent-admin", "handovers"],
    queryFn: async () => {
      const res = await api.get<{ data: Handover[] }>("/sales-agent-admin/handovers")
      return res.data.data ?? []
    },
    retry: 3,
  })

  const agents = liability.data ?? []

  return (
    <div className="space-y-4" dir="rtl">
      <h1 className="text-xl font-semibold">المندوبون</h1>

      {liability.isError ? (
        <Card>
          <CardContent className="p-5 text-sm">
            ما وصلت البيانات. تحقق من الاتصال.
            <Button className="mr-3" onClick={() => void liability.refetch()}>
              حاول مرة أخرى
            </Button>
          </CardContent>
        </Card>
      ) : agents.length === 0 && !liability.isLoading ? (
        <Card>
          <CardContent className="p-5 text-sm text-slate-600">
            ما اكو مندوبين. أنشئ مستخدماً وأعطه صلاحية «مندوب» من صفحة المستخدمين.
          </CardContent>
        </Card>
      ) : (
        <>
          <HandoverPanel
            agents={agents}
            loading={liability.isLoading}
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "liability"] })
              void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "handovers"] })
            }}
          />
          <CommissionPanel agents={agents} />
          <IssueReportsPanel />
          <HandoverHistory rows={handovers.data ?? []} loading={handovers.isLoading} />
        </>
      )}
    </div>
  )
}

/* ── handovers ───────────────────────────────────────────────────────── */

function HandoverPanel({
  agents,
  loading,
  onSaved,
}: {
  agents: Liability[]
  loading: boolean
  onSaved: () => void
}) {
  const [pickedId, setPickedId] = useState("")
  const [amount, setAmount] = useState("")
  const [notes, setNotes] = useState("")

  // Fall back to the first rep rather than requiring a pick. With a single rep
  // — which is the situation today — an unselected panel means the owner types
  // an amount and the save button stays dead with nothing explaining why.
  const agentId = pickedId || agents[0]?.agentId || ""
  const selected = agents.find((a) => a.agentId === agentId) ?? null

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.post("/sales-agent-admin/handovers", {
        agentId,
        amount: Number(amount),
        notes: notes.trim() || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "تم تسجيل الاستلام ✓", description: "وصل إشعار للمندوب" })
      setAmount("")
      setNotes("")
      onSaved()
    },
    onError: (err) =>
      toast({
        title: "ما انسجل",
        description: apiErrorMessage(err, "تحقق من المبلغ"),
        variant: "destructive",
      }),
  })

  const numeric = Number(amount)
  // The server refuses an over-handover outright, so offering a live button
  // that is guaranteed to fail just costs a round trip and an error toast.
  const overLimit = selected != null && numeric > selected.onHand
  const canSave = Boolean(agentId) && numeric > 0 && !overLimit && !save.isPending

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h2 className="font-semibold">ذمة المندوبين</h2>

        {loading ? (
          <div className="text-sm text-slate-500">جاري التحميل…</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((a) => (
              <button
                key={a.agentId}
                type="button"
                onClick={() => setPickedId(a.agentId)}
                className={`rounded-lg border p-3 text-right transition ${
                  a.agentId === agentId
                    ? "border-slate-900 bg-slate-50 dark:border-slate-300 dark:bg-slate-800"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="font-semibold">{a.name}</div>
                <div className="mt-1 text-2xl font-bold tabular-nums">{money(a.onHand)}</div>
                <div className="mt-1 text-xs text-slate-500">
                  <span className="tabular-nums">تحصّل {money(a.collected)}</span>
                  {" · "}
                  <span className="tabular-nums">سلّم {money(a.handedOver)}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">المبلغ المستلم</label>
            <Input
              value={amount}
              inputMode="numeric"
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="0"
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium">ملاحظة</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {selected && numeric > selected.onHand && (
          <p className="text-sm font-medium text-rose-600">
            المبلغ أكبر من الي بذمة {selected.name} ({money(selected.onHand)}).
          </p>
        )}

        <Button disabled={!canSave} onClick={() => save.mutate()}>
          {save.isPending ? "جاري التسجيل…" : "سجّل الاستلام"}
        </Button>
        <p className="text-xs text-slate-500">
          المندوب ما يسجل التسليم بنفسه — أنت تسجله، وتنزل ذمته ويوصله إشعار.
        </p>
      </CardContent>
    </Card>
  )
}

function HandoverHistory({ rows, loading }: { rows: Handover[]; loading: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="font-semibold">سجل التسليمات</h2>
        {loading ? (
          <div className="text-sm text-slate-500">جاري التحميل…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-slate-500">ما اكو تسليمات بعد.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-right text-slate-500">
                  <th className="p-2 font-medium">التاريخ</th>
                  <th className="p-2 font-medium">المندوب</th>
                  <th className="p-2 font-medium">المبلغ</th>
                  <th className="p-2 font-medium">استلمه</th>
                  <th className="p-2 font-medium">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2 tabular-nums">
                      {new Date(r.date).toLocaleDateString("en-GB")}
                    </td>
                    <td className="p-2">{r.agentName}</td>
                    <td className="p-2 font-semibold tabular-nums">{money(r.amount)}</td>
                    <td className="p-2">{r.receivedBy}</td>
                    <td className="p-2 text-slate-500">{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ── commission ──────────────────────────────────────────────────────── */

/**
 * A calculator, not a commission ledger.
 *
 * It stores nothing. The owner picks a rep and a month, sees what was sold and
 * what was actually collected, types whatever rate they agreed, and decides
 * which of the two numbers to pay on. No accruals, no pending balances, no
 * automatic deductions — those would all be state that has to be kept correct
 * forever, to answer a question that is re-asked from scratch every month.
 */
function CommissionPanel({ agents }: { agents: Liability[] }) {
  const [agentId, setAgentId] = useState(agents[0]?.agentId ?? "")
  const [month, setMonth] = useState(currentMonth())
  const [rate, setRate] = useState("")

  const effectiveAgentId = agentId || agents[0]?.agentId || ""
  const rateNumber = rate.trim() === "" ? undefined : Number(rate)

  const commission = useQuery({
    queryKey: ["sales-agent-admin", "commission", effectiveAgentId, month, rateNumber ?? null],
    enabled: Boolean(effectiveAgentId) && /^\d{4}-\d{2}$/.test(month),
    queryFn: async () => {
      const res = await api.get<{ data: Commission }>("/sales-agent-admin/commission", {
        params: {
          agentId: effectiveAgentId,
          month,
          ...(rateNumber != null && Number.isFinite(rateNumber) ? { ratePercent: rateNumber } : {}),
        },
      })
      return res.data.data
    },
    retry: 3,
  })

  const data = commission.data
  const rows = useMemo(
    () => [
      { label: "قيمة المبيعات", value: data?.sold ?? 0, result: data?.onSold ?? null },
      { label: "المُحصَّل فعلياً", value: data?.collected ?? 0, result: data?.onCollected ?? null },
    ],
    [data],
  )

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <h2 className="font-semibold">حساب العمولة</h2>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">المندوب</label>
            <select
              value={effectiveAgentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="h-10 w-full rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">الشهر</label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">النسبة %</label>
            <Input
              value={rate}
              inputMode="decimal"
              onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="مثلاً 3"
            />
          </div>
        </div>

        {commission.isLoading ? (
          <div className="text-sm text-slate-500">جاري الحساب…</div>
        ) : commission.isError ? (
          <div className="text-sm text-rose-600">ما وصل الحساب. تحقق من الاتصال.</div>
        ) : (
          <>
            <div className="text-sm text-slate-500">
              عدد الفواتير هذا الشهر: <span className="tabular-nums">{data?.invoiceCount ?? 0}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-right text-slate-500">
                    <th className="p-2 font-medium">الأساس</th>
                    <th className="p-2 font-medium">المبلغ</th>
                    <th className="p-2 font-medium">العمولة</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label} className="border-b last:border-0">
                      <td className="p-2">{r.label}</td>
                      <td className="p-2 tabular-nums">{money(r.value)}</td>
                      <td className="p-2 text-lg font-bold tabular-nums">
                        {r.result == null ? "— اكتب النسبة" : money(r.result)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-500">
              العمولة على قيمة البيع لا على الربح — السعر مثبّت والمندوب ما يكدر يخصّم، فما اكو
              سبب يخليه يبيع أرخص. القرار على أي رقم تحاسبه يبقى إلك.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ── «المشاكل المسجّلة» — the four reports ───────────────────────────── */

type IssueReports = {
  total: number
  byReason: Array<{ reason: string; label: string; count: number }>
  priceRefusals: Array<{ productId: string; productName: string; salePrice: number | null; count: number }>
  byCustomer: Array<{ customerId: string; customerName: string; area: string | null; count: number }>
  competitors: Array<{
    id: string
    info: string
    reasonLabel: string
    productName: string | null
    ourPrice: number | null
    customerName: string
    area: string | null
    createdAt: string
  }>
}

/**
 * What the reps are hearing in the market.
 *
 * Four reports over one date window, fetched together because the whole point
 * is comparing them: the reasons, the products losing on price, the customers
 * who refuse everything, and — the commercially useful one — what competitors
 * are charging, collected a refusal at a time.
 */
function IssueReportsPanel() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  const reports = useQuery({
    queryKey: ["sales-agent-admin", "issue-reports", from, to],
    queryFn: async () => {
      const res = await api.get<{ data: IssueReports }>("/sales-agent-admin/issue-reports", {
        params: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
      })
      return res.data.data
    },
    retry: 3,
  })

  const d = reports.data

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-semibold">المشاكل المسجّلة</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">من</label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">إلى</label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </div>

        {reports.isLoading ? (
          <div className="text-sm text-slate-500">جاري التحميل…</div>
        ) : reports.isError ? (
          <div className="text-sm text-rose-600">ما وصلت التقارير. تحقق من الاتصال.</div>
        ) : (d?.total ?? 0) === 0 ? (
          <div className="text-sm text-slate-500">
            ما اكو مشاكل مسجّلة بهذي الفترة. المندوب يسجّلها من زر «أكو مشكلة» بصفحة المادة.
          </div>
        ) : (
          <>
            <div className="text-sm text-slate-500">
              مجموع المشاكل: <span className="tabular-nums">{d?.total ?? 0}</span>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <ReportTable
                title="أكثر أسباب الرفض"
                head={["السبب", "العدد"]}
                rows={(d?.byReason ?? []).map((r) => [r.label, String(r.count)])}
                empty="ما اكو"
              />

              <ReportTable
                title="مواد مرفوضة بسبب السعر"
                head={["المادة", "سعرنا", "مرات الرفض"]}
                rows={(d?.priceRefusals ?? []).map((r) => [
                  r.productName,
                  r.salePrice == null ? "—" : money(r.salePrice),
                  String(r.count),
                ])}
                empty="ما اكو رفض بسبب السعر"
              />

              <ReportTable
                title="أكثر الزبائن رفضاً"
                head={["الزبون", "المنطقة", "العدد"]}
                rows={(d?.byCustomer ?? []).map((r) => [
                  r.customerName,
                  r.area ?? "—",
                  String(r.count),
                ])}
                empty="ما اكو"
              />

              <ReportTable
                title="أسعار المنافسين"
                head={["المادة", "سعرنا", "المنافس", "الزبون"]}
                rows={(d?.competitors ?? []).map((r) => [
                  r.productName ?? "—",
                  r.ourPrice == null ? "—" : money(r.ourPrice),
                  r.info,
                  r.customerName,
                ])}
                empty="ما جمع المندوب أسعار منافسين بعد"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ReportTable({
  title,
  head,
  rows,
  empty,
}: {
  title: string
  head: string[]
  rows: string[][]
  empty: string
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-600">{title}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500">{empty}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-right text-slate-500">
                {head.map((h) => (
                  <th key={h} className="p-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 15).map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  {r.map((cell, j) => (
                    <td key={j} className={j === 0 ? "p-2" : "p-2 tabular-nums"}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
