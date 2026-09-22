/**
 * «يومي» — where the rep's day starts.
 *
 * The rep opens the app in the morning and the first question is «وين أبدي؟».
 * The answer used to be spread across four tabs. This screen puts the three
 * things that decide it on one page:
 *
 *   1. anything left hanging — an order that may not have been sent, orders the
 *      owner has not decided, an order that came back refused;
 *   2. who to see today — the owner's plan, or, with no plan, the customers
 *      whose account says they need a visit;
 *   3. where the day stands — sold, collected, cash in hand.
 *
 * Every figure follows the page's rule: a read that failed or has not arrived
 * prints «—» or «…», never 0. A zero is a claim about the rep's day.
 */
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ClipboardList, Receipt, ShoppingCart, UserPlus, Users, Wallet } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { QueryErrorBox } from "../../components/ui/query-error"
import { cn } from "../../utils/cn"
import { money } from "./format"
import type { AgentOrder, AgentToday, CashOnHand, CustomerPage } from "./model"
import type { VisitPlanEntry } from "./types"
import { StatusPill, Waiting } from "./ui"

type TodayPlan = { date: string; entries: VisitPlanEntry[] }

function Figure({
  title,
  value,
  sub,
  icon,
  tone = "plain",
}: {
  title: string
  value: string
  sub?: string
  icon: React.ReactNode
  tone?: "plain" | "warn"
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        tone === "warn"
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
          : "border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)]",
      )}
    >
      <div className="flex items-center gap-2 text-[12px] text-slate-500">
        {icon}
        {title}
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-slate-500">{sub}</p>}
    </div>
  )
}

export function TodayScreen({
  repName,
  unresolvedCount,
  onOpenPending,
  onSell,
  onOpenStatement,
  onGo,
}: {
  repName: string
  /** Orders on THIS device that may not have reached the shop. */
  unresolvedCount: number
  onOpenPending: () => void
  /** Pick this customer and open the catalog on their cart. */
  onSell: (customerId: string) => void
  onOpenStatement: (customerId: string) => void
  onGo: (screen: "catalog" | "customers" | "receipts" | "orders" | "visits" | "new-customer") => void
}) {
  // The same keys the other tabs use, so this screen and those tabs share one
  // cache and one set of realtime refreshes — never two answers to one question.
  const today = useQuery({
    queryKey: ["sales-agent", "today"],
    queryFn: async () => (await api.get<{ data: AgentToday }>("/sales-agent/today")).data.data,
    retry: 3,
  })
  const cash = useQuery({
    queryKey: ["sales-agent", "cash"],
    queryFn: async () => (await api.get<{ data: CashOnHand }>("/sales-agent/cash-on-hand")).data.data,
    retry: 3,
  })
  const plan = useQuery({
    queryKey: ["sales-agent", "visit-plan"],
    queryFn: async () => (await api.get<{ data: TodayPlan }>("/sales-agent/visits/plan")).data.data,
    retry: 3,
  })
  const orders = useQuery({
    queryKey: ["sales-agent", "orders"],
    queryFn: async () => (await api.get<{ data: AgentOrder[] }>("/sales-agent/orders")).data.data ?? [],
    retry: 3,
  })
  // Only asked for when there is no plan: the owner's plan, when there is one,
  // IS the answer to «who today».
  const planEntries = plan.data?.entries ?? []
  const needPlanFallback = plan.isSuccess && planEntries.length === 0
  const followUp = useQuery({
    queryKey: ["sales-agent", "customers", "today-follow-up"],
    enabled: needPlanFallback,
    queryFn: async () =>
      (
        await api.get<{ data: CustomerPage }>("/sales-agent/customers", {
          params: { page: 1, limit: 6, needsFollowUp: true, withReasons: true },
        })
      ).data.data,
    retry: 3,
  })

  const todayBroken = Boolean(today.error) || today.fetchStatus === "paused"
  const cashBroken = Boolean(cash.error) || cash.fetchStatus === "paused"
  const d = today.data
  const figure = (broken: boolean, value: number | undefined) => (broken ? "—" : value == null ? "…" : money(value))

  const waitingOnOwner = (orders.data ?? []).filter((o) => o.status === "PENDING").length
  const refusedToday = d?.rejectedOrders ?? 0

  const hello = (() => {
    const h = new Date().getHours()
    return h < 12 ? "صباح الخير" : h < 18 ? "مساء الخير" : "مساء النور"
  })()

  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-bold">
          {hello}
          {repName ? ` ${repName}` : ""}
        </p>
        <p className="text-[13px] text-slate-500">
          {new Date().toLocaleDateString("ar-IQ", { weekday: "long", day: "numeric", month: "long" })}
        </p>
      </div>

      {/* Anything left hanging comes first: an unsent order is the one thing on
          this screen that can cost the shop a sale if it waits. */}
      {(unresolvedCount > 0 || waitingOnOwner > 0 || refusedToday > 0) && (
        <div className="space-y-2">
          {unresolvedCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
              <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-[13px] font-medium text-amber-900 dark:text-amber-200">
                {unresolvedCount} طلب على هذا الجهاز ما تأكد إنه وصل للمحل
              </p>
              <Button className="h-11" onClick={onOpenPending}>راجعها</Button>
            </div>
          )}
          {refusedToday > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
              <p className="min-w-0 flex-1 text-[13px] font-medium text-red-800 dark:text-red-200">
                {refusedToday} طلب رجع مرفوض اليوم
                {d?.rejectedValue ? <span className="tabular-nums"> · {money(d.rejectedValue)}</span> : null}
              </p>
              <Button variant="outline" className="h-11" onClick={() => onGo("orders")}>شوف السبب</Button>
            </div>
          )}
          {waitingOnOwner > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)] p-3">
              <p className="min-w-0 flex-1 text-[13px] text-slate-600 dark:text-slate-300">
                {waitingOnOwner} طلب بانتظار موافقة صاحب المحل
              </p>
              <Button variant="outline" className="h-11" onClick={() => onGo("orders")}>طلباتي</Button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Figure
          title="قبضت اليوم"
          value={figure(todayBroken, d?.collected)}
          sub={todayBroken ? "ما وصل الرقم" : d ? `${d.receipts} سند` : undefined}
          icon={<Receipt className="size-4" />}
        />
        <Figure
          title="بعت اليوم"
          value={figure(todayBroken, d?.orderValue)}
          sub={todayBroken ? "ما وصل الرقم" : d ? `${d.orders} طلب` : undefined}
          icon={<ShoppingCart className="size-4" />}
        />
        <Figure
          title="زرت اليوم"
          value={todayBroken ? "—" : d ? String(d.customersVisited) : "…"}
          sub={todayBroken ? "ما وصل الرقم" : d ? `${d.newCustomers} زبون جديد` : undefined}
          icon={<Users className="size-4" />}
        />
        <Figure
          title="معي الآن"
          value={figure(cashBroken, cash.data?.onHand)}
          sub={cashBroken ? "ما وصل الرقم" : undefined}
          icon={<Wallet className="size-4" />}
          tone={cash.data && cash.data.onHand < 0 ? "warn" : "plain"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{needPlanFallback ? "يحتاجون زيارة" : "زبائن اليوم"}</CardTitle>
          <Button variant="outline" className="h-11" onClick={() => onGo(needPlanFallback ? "customers" : "visits")}>
            <ClipboardList className="size-4" /> {needPlanFallback ? "كل زبائني" : "خطة الزيارات"}
          </Button>
        </CardHeader>
        <CardContent>
          {plan.isPending ? (
            <Waiting q={plan} />
          ) : plan.error ? (
            <QueryErrorBox title="ما وصلت خطة اليوم" onRetry={() => void plan.refetch()} />
          ) : !needPlanFallback ? (
            <ul className="space-y-2">
              {planEntries.map((entry) => {
                const done = Boolean(entry.visit?.endedAt)
                return (
                  <li
                    key={entry.id}
                    className={cn("rounded-xl border p-3", done && "opacity-60")}
                    style={{ borderColor: "var(--theme-cardBorder)" }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{entry.customerName}</p>
                        <p className="text-[12px] text-slate-500">
                          {[entry.area, entry.address].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusPill tone={done ? "ok" : entry.visit ? "wait" : "muted"}>
                          {entry.visit?.outcomeLabel ?? entry.statusLabel}
                        </StatusPill>
                        {entry.currentBalance > 0 && (
                          <span className="text-[12px] tabular-nums text-amber-700 dark:text-amber-300">
                            عليه {money(entry.currentBalance)}
                          </span>
                        )}
                      </div>
                    </div>
                    {entry.note && <p className="mt-1 text-[12px] text-slate-500">{entry.note}</p>}
                    <div className="mt-2 flex gap-2">
                      <Button className="h-11 flex-1" onClick={() => onSell(entry.customerId)}>بيع</Button>
                      <Button variant="outline" className="h-11 flex-1" onClick={() => onOpenStatement(entry.customerId)}>
                        كشف الحساب
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : followUp.isPending ? (
            <Waiting q={followUp} />
          ) : followUp.error ? (
            <QueryErrorBox title="ما وصلت القائمة" onRetry={() => void followUp.refetch()} />
          ) : (followUp.data?.customers ?? []).length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              ماكو خطة لليوم، وكل زبائنك ماشين تمام.
            </p>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-slate-500">
                ماكو خطة من صاحب المحل لليوم — هذولة الي حسابهم يقول يحتاجون زيارة.
              </p>
              <ul className="space-y-2">
                {(followUp.data?.customers ?? []).map((c) => (
                  <li key={c.id} className="rounded-xl border p-3" style={{ borderColor: "var(--theme-cardBorder)" }}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{c.name}</p>
                        <p className="text-[12px] text-slate-500">{c.area ?? "—"}</p>
                      </div>
                      {c.currentBalance > 0 && (
                        <span className="text-[12px] tabular-nums text-amber-700 dark:text-amber-300">
                          عليه {money(c.currentBalance)}
                        </span>
                      )}
                    </div>
                    {(c.followUpReasons ?? []).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(c.followUpReasons ?? []).map((r) => (
                          <StatusPill key={r.code} tone="wait">{r.label}</StatusPill>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      <Button className="h-11 flex-1" onClick={() => onSell(c.id)}>بيع</Button>
                      <Button variant="outline" className="h-11 flex-1" onClick={() => onOpenStatement(c.id)}>
                        كشف الحساب
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" className="h-14 flex-col gap-1" onClick={() => onGo("catalog")}>
          <ShoppingCart className="size-5" /> طلب جديد
        </Button>
        <Button variant="outline" className="h-14 flex-col gap-1" onClick={() => onGo("receipts")}>
          <Receipt className="size-5" /> سند قبض
        </Button>
        <Button variant="outline" className="h-14 flex-col gap-1" onClick={() => onGo("new-customer")}>
          <UserPlus className="size-5" /> زبون جديد
        </Button>
      </div>
    </div>
  )
}
