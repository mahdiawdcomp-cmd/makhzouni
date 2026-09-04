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
import { useMemo, useRef, useState } from "react"
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
  isActive: boolean
  collected: number
  handedOver: number
  onHand: number
  /** A receipt was cancelled after its cash had already been handed over. */
  overHanded: boolean
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
  dateBasis: string
  invoiceCount: number
  sold: number
  /** What the rep physically took — includes old debt and the shop's own sales. */
  collectedInHand: number
  /** Receipts from this rep's customers, whoever collected them. */
  collectedFromOwnCustomers: number
  /** The part of collectedInHand that came from customers who are not his. */
  collectedFromOtherCustomers: number
  ratePercent: number | null
  onSold: number | null
  onCollectedInHand: number | null
  onCollectedFromOwn: number | null
  /** Present once the month is frozen — the agreement, not the live figures. */
  settled: Settlement | null
}

type Settlement = {
  sold: number
  collectedInHand: number
  collectedFromOwnCustomers: number
  basis: string
  basisLabel: string
  ratePercent: number
  amount: number
  notes: string | null
  settledAt: string
  settledBy: string
}

const BASES = [
  { key: "SOLD", label: "قيمة مبيعاته" },
  { key: "COLLECTED_FROM_OWN", label: "تحصيل من زبائنه" },
  { key: "COLLECTED_IN_HAND", label: "الي قبضه بيده" },
] as const

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
          <LiabilityHealthPanel />
          <IssueReportsPanel />
          <RawIssueLog />
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
  // One key per attempt: a double tap sends the same key and gets the first
  // handover back instead of taking the cash off the rep twice.
  const requestId = useRef(crypto.randomUUID())

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
        clientRequestId: requestId.current,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "تم تسجيل الاستلام ✓", description: "وصل إشعار للمندوب" })
      setAmount("")
      setNotes("")
      requestId.current = crypto.randomUUID()
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
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{a.name}</span>
                  {!a.isActive && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      حساب معطّل
                    </span>
                  )}
                </div>
                <div
                  className={`mt-1 text-2xl font-bold tabular-nums ${a.overHanded ? "text-rose-600" : ""}`}
                >
                  {money(a.onHand)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  <span className="tabular-nums">تحصّل {money(a.collected)}</span>
                  {" · "}
                  <span className="tabular-nums">سلّم {money(a.handedOver)}</span>
                </div>
                {a.overHanded && (
                  <div className="mt-1 text-xs font-semibold text-rose-600">
                    سلّم أكثر مما بذمته — على الأغلب انلغى سند بعد التسليم. راجعه.
                  </div>
                )}
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
  const qc = useQueryClient()
  const [agentId, setAgentId] = useState(agents[0]?.agentId ?? "")
  const [month, setMonth] = useState(currentMonth())
  const [rate, setRate] = useState("")
  const [basis, setBasis] = useState<string>("SOLD")
  const [settleNotes, setSettleNotes] = useState("")

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
  const settled = data?.settled ?? null

  const refreshCommission = () => {
    void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "commission"] })
    void qc.invalidateQueries({ queryKey: ["sales-agent-admin", "settlements"] })
  }

  const settle = useMutation({
    mutationFn: async () => {
      const res = await api.post("/sales-agent-admin/settlements", {
        agentId: effectiveAgentId,
        month,
        basis,
        ratePercent: Number(rate),
        notes: settleNotes.trim() || undefined,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "تم تثبيت الشهر ✓", description: "الرقم محفوظ ولا يتغيّر بعد اليوم" })
      setSettleNotes("")
      refreshCommission()
    },
    onError: (err) =>
      toast({
        title: "ما انثبّت",
        description: apiErrorMessage(err, "حاول مرة أخرى"),
        variant: "destructive",
      }),
  })

  const reopen = useMutation({
    mutationFn: async () => {
      const res = await api.delete("/sales-agent-admin/settlements", {
        params: { agentId: effectiveAgentId, month },
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انفتح الشهر", description: "الأرقام رجعت تُقرأ حيّة" })
      refreshCommission()
    },
    onError: (err) =>
      toast({ title: "ما انفتح", description: apiErrorMessage(err), variant: "destructive" }),
  })
  // Three bases, not two. "How much did he collect" has three honest answers and
  // paying a person on the wrong one is a dispute, so each is named for exactly
  // what it counts rather than one of them being labelled «المُحصَّل فعلياً».
  const rows = useMemo(
    () => [
      {
        label: "قيمة مبيعاته",
        hint: "فواتيره الفعّالة بهذا الشهر، على تاريخ الفوترة",
        value: data?.sold ?? 0,
        result: data?.onSold ?? null,
      },
      {
        label: "تحصيل من زبائنه",
        hint: "سندات زبائنه بهذا الشهر، مهما كان من قبضها",
        value: data?.collectedFromOwnCustomers ?? 0,
        result: data?.onCollectedFromOwn ?? null,
      },
      {
        label: "الي قبضه بيده",
        hint: "كل ما قبضه — يشمل ديوناً قديمة وزبائن مو زبائنه",
        value: data?.collectedInHand ?? 0,
        result: data?.onCollectedInHand ?? null,
      },
    ],
    [data],
  )
  const foreignShare = data?.collectedFromOtherCustomers ?? 0

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
              {" · "}
              الشهر محسوب على تاريخ الفوترة (يوم موافقتك)، لا يوم إرسال الطلب
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
                      <td className="p-2">
                        <span className="font-medium">{r.label}</span>
                        <span className="block text-xs text-slate-500">{r.hint}</span>
                      </td>
                      <td className="p-2 tabular-nums">{money(r.value)}</td>
                      <td className="p-2 text-lg font-bold tabular-nums">
                        {r.result == null ? "— اكتب النسبة" : money(r.result)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* «تثبيت الشهر» — the agreement, kept as it stood.
                Once settled, the frozen figures lead and the live ones sit
                beside them, so the owner can SEE the books have moved without
                the agreed payout moving with them. */}
            {settled ? (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">الشهر مثبّت</span>
                  <span className="text-xs text-slate-500">
                    {settled.settledBy} — {new Date(settled.settledAt).toLocaleDateString("en-GB")}
                  </span>
                </div>
                <div className="mt-2 text-3xl font-bold tabular-nums">{money(settled.amount)}</div>
                <div className="mt-1 text-sm">
                  {settled.basisLabel} × {settled.ratePercent}%
                </div>
                {settled.notes && (
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">{settled.notes}</div>
                )}

                {/* The point of freezing: show the drift instead of hiding it. */}
                {(settled.sold !== (data?.sold ?? 0) ||
                  settled.collectedFromOwnCustomers !== (data?.collectedFromOwnCustomers ?? 0) ||
                  settled.collectedInHand !== (data?.collectedInHand ?? 0)) && (
                  <div className="mt-3 rounded-md bg-amber-100 p-2 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    الدفاتر تغيّرت بعد التثبيت — مبيعات{" "}
                    <span className="tabular-nums">{money(settled.sold)}</span> صارت{" "}
                    <span className="tabular-nums">{money(data?.sold ?? 0)}</span>. الرقم المثبّت ما
                    يتأثر.
                  </div>
                )}

                <Button
                  variant="outline"
                  className="mt-3"
                  disabled={reopen.isPending}
                  onClick={() => reopen.mutate()}
                >
                  {reopen.isPending ? "جاري الفتح…" : "افتح الشهر من جديد"}
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <div className="font-semibold">ثبّت الشهر</div>
                <p className="mt-1 text-xs text-slate-500">
                  بعد ما تتفق على رقم مع المندوب، ثبّته. الأرقام أعلاه تُقرأ حيّة، فأي فاتورة
                  تنلغي أو زبون ينتقل بعدها يغيّر الأساس الي حاسبته عليه.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">تحاسبه على</label>
                    <select
                      value={basis}
                      onChange={(e) => setBasis(e.target.value)}
                      className="h-10 w-full rounded-md border bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    >
                      {BASES.map((b) => (
                        <option key={b.key} value={b.key}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium">ملاحظة (اختياري)</label>
                    <Input value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)} />
                  </div>
                </div>
                <Button
                  className="mt-3"
                  disabled={!(Number(rate) > 0) || settle.isPending}
                  onClick={() => settle.mutate()}
                >
                  {settle.isPending ? "جاري التثبيت…" : "ثبّت الشهر"}
                </Button>
                {!(Number(rate) > 0) && (
                  <span className="mr-3 text-xs text-slate-500">اكتب النسبة أولاً</span>
                )}
              </div>
            )}

            {foreignShare > 0 && (
              <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
                انتبه: <span className="tabular-nums">{money(foreignShare)}</span> مما قبضه هذا
                الشهر جاء من زبائن مو زبائنه — ما يخص بيعه هو.
              </p>
            )}

            <p className="text-xs text-slate-500">
              «تحصيل من زبائنه» يتبع الزبائن المربوطين به <b>اليوم</b>. إذا نقلت زبوناً لمندوب
              ثاني، رقم الشهر الماضي يتغيّر معه — فثبّت المحاسبة قبل ما تنقل الزبائن.
            </p>
            <p className="text-xs text-slate-500">
              العمولة على قيمة البيع لا على الربح — السعر مثبّت والمندوب ما يكدر يخصّم، فما اكو
              سبب يخليه يبيع أرخص. النظام ما يوزّع السندات على فواتير بعينها، فما اكو رقم
              «تحصيل مقابل فواتيره هو» — الرقمان أعلاه هما أقرب جواب صادق موجود. القرار على أي
              رقم تحاسبه يبقى إلك.
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

/* ── «صحة الذمة» — everything wrong, in one glance ───────────────────── */

type Health = {
  negativeLiability: Array<{ agentId: string; name: string; onHand: number }>
  inactiveWithMoney: Array<{ agentId: string; name: string; onHand: number }>
  cancelledReceipts: Array<{
    id: string; voucherNumber: string; amount: number; cancelledAt: string
    agentName: string; customerName: string
  }>
  staleApprovedPrices: Array<{
    id: string; productName: string; customerName: string; agentName: string
    currentPrice: number; requestedPrice: number; approvedAt: string
  }>
  collectionsFromOthersCustomers: Array<{
    id: string; voucherNumber: string; amount: number; date: string
    agentName: string; customerName: string
  }>
}

/**
 * The states that go wrong quietly.
 *
 * Each of these is individually recoverable and individually invisible — nothing
 * surfaces them unless somebody happens to open the right screen on the right
 * day. Gathered here so a weekly glance is enough, and shown as a clean "no
 * problems" line when there are none, rather than five empty tables.
 */
function LiabilityHealthPanel() {
  const health = useQuery({
    queryKey: ["sales-agent-admin", "health"],
    queryFn: async () => {
      const res = await api.get<{ data: Health }>("/sales-agent-admin/health")
      return res.data.data
    },
    retry: 3,
  })

  const d = health.data
  const count =
    (d?.negativeLiability.length ?? 0) +
    (d?.inactiveWithMoney.length ?? 0) +
    (d?.cancelledReceipts.length ?? 0) +
    (d?.staleApprovedPrices.length ?? 0) +
    (d?.collectionsFromOthersCustomers.length ?? 0)

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">صحة ذمم المندوبين</h2>
          {d && (
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                count === 0
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
              }`}
            >
              {count === 0 ? "ما اكو مشاكل" : `${count} تحتاج نظرة`}
            </span>
          )}
        </div>

        {health.isLoading ? (
          <div className="text-sm text-slate-500">جاري الفحص…</div>
        ) : health.isError ? (
          <div className="text-sm text-rose-600">ما وصل الفحص. تحقق من الاتصال.</div>
        ) : count === 0 ? (
          <p className="text-sm text-slate-500">
            كل الذمم سليمة: ما اكو رصيد سالب، ولا مندوب معطّل عليه فلوس، ولا سعر موافق عليه
            منسي.
          </p>
        ) : (
          <div className="space-y-4">
            <HealthBlock
              title="ذمة سالبة"
              why="انلغى سند بعد ما تسلّمت نقده. راجع السند أو سجّل تسوية."
              rows={(d?.negativeLiability ?? []).map((a) => [a.name, money(a.onHand)])}
              head={["المندوب", "الرصيد"]}
            />
            <HealthBlock
              title="مندوب معطّل وعليه فلوس"
              why="الحساب مقفول لكن الذمة مفتوحة."
              rows={(d?.inactiveWithMoney ?? []).map((a) => [a.name, money(a.onHand)])}
              head={["المندوب", "الباقي"]}
            />
            <HealthBlock
              title="سندات ملغاة كان المندوب قبضها"
              why="كل واحد منها ينقص من ذمته بأثر رجعي."
              rows={(d?.cancelledReceipts ?? []).map((r) => [
                r.voucherNumber,
                r.agentName,
                r.customerName,
                money(r.amount),
              ])}
              head={["السند", "المندوب", "الزبون", "المبلغ"]}
            />
            <HealthBlock
              title="أسعار خاصة موافق عليها وما انستعملت"
              why="وافقت على سعر من أكثر من أسبوعين وما انباع بيه شي."
              rows={(d?.staleApprovedPrices ?? []).map((r) => [
                r.productName,
                r.customerName,
                `${money(r.currentPrice)} ← ${money(r.requestedPrice)}`,
                new Date(r.approvedAt).toLocaleDateString("en-GB"),
              ])}
              head={["المادة", "الزبون", "السعر", "منذ"]}
            />
            <HealthBlock
              title="قبض من زبائن مو زبائنه"
              why="غالباً الزبون انتقل لمندوب ثاني بعد القبض — يأثر على حساب العمولة."
              rows={(d?.collectionsFromOthersCustomers ?? []).map((r) => [
                r.voucherNumber,
                r.agentName,
                r.customerName,
                money(r.amount),
              ])}
              head={["السند", "المندوب", "الزبون", "المبلغ"]}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HealthBlock({
  title,
  why,
  head,
  rows,
}: {
  title: string
  why: string
  head: string[]
  rows: string[][]
}) {
  // A block with nothing wrong is not rendered at all: five empty tables read as
  // "this screen is broken", one populated table reads as "look here".
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-900/10">
      <div className="text-sm font-semibold">
        {title} <span className="tabular-nums text-slate-500">({rows.length})</span>
      </div>
      <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">{why}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-right text-slate-500">
              {head.map((h) => (
                <th key={h} className="p-1.5 text-xs font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 12).map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                {r.map((cell, j) => (
                  <td key={j} className={j === 0 ? "p-1.5" : "p-1.5 tabular-nums"}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ── the raw refusal log ─────────────────────────────────────────────── */

type RawIssue = {
  id: string
  reasonLabel: string
  note: string | null
  competitorInfo: string | null
  createdAt: string
  agentName: string
  customerName: string
  area: string | null
  productName: string | null
}

/**
 * The refusals one by one.
 *
 * The four reports answer "what is going wrong overall"; this answers "what
 * exactly did he hear in that shop". A single competitor quote is often worth
 * more than the count it disappears into.
 */
function RawIssueLog() {
  const [open, setOpen] = useState(false)
  const issues = useQuery({
    queryKey: ["sales-agent-admin", "issues-raw"],
    enabled: open,
    queryFn: async () => {
      const res = await api.get<{ data: RawIssue[] }>("/sales-agent-admin/issues")
      return res.data.data ?? []
    },
    retry: 3,
  })

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">سجل المشاكل واحدة واحدة</h2>
          <Button variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "إخفاء" : "اعرض"}
          </Button>
        </div>

        {open &&
          (issues.isLoading ? (
            <div className="text-sm text-slate-500">جاري التحميل…</div>
          ) : (issues.data ?? []).length === 0 ? (
            <div className="text-sm text-slate-500">ما اكو مشاكل مسجّلة.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-right text-slate-500">
                    <th className="p-2 font-medium">التاريخ</th>
                    <th className="p-2 font-medium">الزبون</th>
                    <th className="p-2 font-medium">المادة</th>
                    <th className="p-2 font-medium">السبب</th>
                    <th className="p-2 font-medium">الملاحظة</th>
                    <th className="p-2 font-medium">المنافس</th>
                  </tr>
                </thead>
                <tbody>
                  {(issues.data ?? []).map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="p-2 tabular-nums">
                        {new Date(r.createdAt).toLocaleDateString("en-GB")}
                      </td>
                      <td className="p-2">
                        {r.customerName}
                        {r.area ? <span className="block text-xs text-slate-500">{r.area}</span> : null}
                      </td>
                      <td className="p-2">{r.productName ?? "—"}</td>
                      <td className="p-2">{r.reasonLabel}</td>
                      <td className="p-2 text-slate-600 dark:text-slate-400">{r.note ?? "—"}</td>
                      <td className="p-2 text-slate-600 dark:text-slate-400">
                        {r.competitorInfo ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </CardContent>
    </Card>
  )
}
