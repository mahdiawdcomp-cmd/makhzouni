import { useRef, useState } from "react"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Receipt, ShoppingCart, Users, Wallet } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Input } from "../../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table"
import { toast } from "../../components/ui/use-toast"
import { QueryErrorBox } from "../../components/ui/query-error"
import { apiErrorMessage } from "../../utils/apiError"
import { money, shortDate } from "./format"
import { readAgentLocation } from "../../utils/agentLocation"
import { type AgentToday, type CashOnHand, type AgentReceipt, type AgentHandoverRow, digitsOnly } from "./model"
import { Field, StatusPill, Waiting } from "./ui"
import { useOnce } from "./hooks"

/**
 * «فلوسي» — everything about money in one screen.
 *
 * «معي الآن» is the number the rep is personally answerable for, so it leads.
 * The day's takings sit beside it — sales AND collections — because both are
 * money and the rep was looking for them here rather than under «طلباتي».
 *
 * The rep records receipts here but NEVER a handover: only the owner writes
 * those.
 */
export function MoneyScreen({
  section,
  customerId,
  customerName,
  onNeedCustomer,
}: {
  // «فلوسي» = the rep's cash figures and handovers; «سنداتي» = recording and
  // listing receipts. Each section only runs the queries it shows.
  section: "money" | "receipts"
  customerId: string | null
  customerName: string | null
  onNeedCustomer: () => void
}) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState("")
  const [notes, setNotes] = useState("")
  // A fresh key per saved receipt, so a retry after a timeout cannot bill twice.
  const requestId = useRef(crypto.randomUUID())

  const cash = useQuery({
    queryKey: ["sales-agent", "cash"],
    enabled: section === "money",
    queryFn: async () => {
      const res = await api.get<{ data: CashOnHand }>("/sales-agent/cash-on-hand")
      return res.data.data
    },
    retry: 3,
  })

  const today = useQuery({
    queryKey: ["sales-agent", "today"],
    enabled: section === "money",
    queryFn: async () => {
      const res = await api.get<{ data: AgentToday }>("/sales-agent/today")
      return res.data.data
    },
    retry: 3,
  })

  // Paged by offset: the list used to stop at the newest 40, so a rep could
  // never see an older receipt. The server orders by (date, id), which keeps
  // the pages from overlapping.
  const RECEIPTS_PAGE = 40
  const receipts = useInfiniteQuery({
    queryKey: ["sales-agent", "receipts"],
    enabled: section === "receipts",
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await api.get<{ data: AgentReceipt[] }>("/sales-agent/receipts", {
        params: { limit: RECEIPTS_PAGE, offset: pageParam },
      })
      return res.data.data ?? []
    },
    getNextPageParam: (last, all) => (last.length === RECEIPTS_PAGE ? all.length * RECEIPTS_PAGE : undefined),
    retry: 3,
  })
  const receiptRows = receipts.data?.pages.flat() ?? []

  const handovers = useQuery({
    queryKey: ["sales-agent", "handovers"],
    enabled: section === "money",
    queryFn: async () => {
      const res = await api.get<{ data: AgentHandoverRow[] }>("/sales-agent/handovers")
      return res.data.data ?? []
    },
    retry: 3,
  })

  const save = useMutation({
    mutationFn: async () => {
      // Read HERE, not at render: the position that matters is where the rep
      // stood when they took the money. A receipt is always written online —
      // unlike a cart, it has no offline draft — so reading it now is honest.
      const location = await readAgentLocation()
      const res = await api.post("/sales-agent/receipts", {
        customerId,
        amount: Number(amount),
        notes: notes.trim() || undefined,
        clientRequestId: requestId.current,
        location,
      })
      return res.data
    },
    onSuccess: () => {
      toast({ title: "انحفظ السند ✓" })
      setAmount("")
      setNotes("")
      requestId.current = crypto.randomUUID()
      void qc.invalidateQueries({ queryKey: ["sales-agent", "cash"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "receipts"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "today"] })
      // The customer just paid, so the balance in the page header is stale.
      void qc.invalidateQueries({ queryKey: ["sales-agent", "customer-header"] })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "customers"] })
    },
    onError: (err) =>
      toast({
        title: "ما انحفظ السند",
        description: apiErrorMessage(err, "تحقق من المبلغ وحاول مرة أخرى"),
        variant: "destructive",
      }),
  })

  const saveReceipt = useOnce(save)

  const canSave = Boolean(customerId) && Number(amount) > 0 && !save.isPending
  const onHand = cash.data?.onHand ?? 0
  const d = today.data
  // A failed request must not print «معي الآن 0». Zero is a claim about the
  // rep's own cash, and they would act on it.
  const cashBroken = Boolean(cash.error) || cash.fetchStatus === "paused"
  const todayBroken = Boolean(today.error) || today.fetchStatus === "paused"

  return (
    <div className="space-y-4">
      {section === "money" && (
      <>
      {/* Three figures, and deliberately not a fourth: nothing here is a number
          the owner keeps private, so the rep reads their own day without the
          commission ever appearing on their phone. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          title="معي الآن"
          value={cashBroken ? "—" : cash.isPending ? "…" : money(onHand)}
          sub={
            cashBroken
              ? "ما وصل الرقم — تحقق من الاتصال"
              : cash.data
                ? `تحصّلت ${money(cash.data.collected)} · سلّمت ${money(cash.data.handedOver)}`
                : undefined
          }
          color={onHand < 0 ? "#EF4444" : "var(--theme-receipt)"}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatTile
          title="مبيعاتي اليوم"
          value={todayBroken ? "—" : d ? money(d.orderValue) : "…"}
          sub={
            todayBroken
              ? "ما وصل الرقم — تحقق من الاتصال"
              : d
              ? `${d.orders} طلب · ${d.customersVisited} زبون` +
                // Named rather than hidden: a rep whose figure drops should see
                // why, not wonder whether the screen is wrong.
                (d.rejectedOrders > 0 ? ` · ${d.rejectedOrders} مرفوض (${money(d.rejectedValue)})` : "")
              : undefined
          }
          color="var(--theme-accent)"
          icon={<ShoppingCart className="h-5 w-5" />}
        />
        <StatTile
          title="قبضت اليوم"
          value={todayBroken ? "—" : d ? money(d.collected) : "…"}
          sub={
            todayBroken
              ? "ما وصل الرقم — تحقق من الاتصال"
              : d
                ? `${d.receipts} سند · ${d.issues} مشكلة`
                : undefined
          }
          color="var(--theme-payment)"
          icon={<Receipt className="h-5 w-5" />}
        />
      </div>

      {onHand < 0 && !cashBroken && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-[13px] font-medium text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          الرصيد سالب — انلغى سند بعد ما سلّمته. راجع صاحب المحل.
        </div>
      )}
      </>
      )}

      {section === "receipts" && (
      <>
      <Card>
        <CardHeader>
          <CardTitle>سجّل سند قبض</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {customerId ? (
            <p className="rounded bg-[var(--theme-accentSoft)] px-3 py-2 text-[13px] font-medium text-[var(--theme-accentDark)]">
              الزبون: {customerName}
            </p>
          ) : (
            <Button variant="outline" className="h-11" onClick={onNeedCustomer}>
              <Users className="h-4 w-4" /> اختر الزبون أول
            </Button>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المبلغ">
              <Input
                value={amount}
                inputMode="numeric"
                onChange={(e) => setAmount(digitsOnly(e.target.value))}
                className="h-11 text-lg font-bold tabular-nums"
              />
            </Field>
            <Field label="ملاحظة">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11" />
            </Field>
          </div>

          <Button className="h-11" disabled={!canSave} onClick={saveReceipt}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {save.isPending ? "جاري الحفظ…" : "احفظ السند"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سنداتي</CardTitle>
          <span className="text-[12px] text-slate-500 tabular-nums">
            {receiptRows.length} سند
          </span>
        </CardHeader>
        <CardContent>
          {receipts.isPending ? (
            <Waiting q={receipts} />
          ) : receipts.error ? (
            <QueryErrorBox title="ما وصلت السندات" onRetry={() => void receipts.refetch()} />
          ) : receiptRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">ما اكو سندات</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>السند</TH>
                  <TH>الزبون</TH>
                  <TH>المبلغ</TH>
                  <TH>التاريخ</TH>
                </TR>
              </THead>
              <TBody>
                {receiptRows.map((r) => (
                  <TR key={r.id} className={r.cancelled ? "opacity-60" : ""}>
                    <TD className="tabular-nums">{r.voucherNumber}</TD>
                    <TD>{r.customerName}</TD>
                    <TD className="font-medium tabular-nums">{money(r.amount)}</TD>
                    <TD className="tabular-nums">
                      {shortDate(r.date)}
                      {r.cancelled && <StatusPill tone="bad">ملغي</StatusPill>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {receipts.hasNextPage && (
            <Button
              variant="outline"
              className="mt-3 h-11 w-full"
              disabled={receipts.isFetchingNextPage}
              onClick={() => void receipts.fetchNextPage()}
            >
              {receipts.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              عرض المزيد
            </Button>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {section === "money" && (
      <Card>
        <CardHeader>
          <CardTitle>تسليماتي</CardTitle>
        </CardHeader>
        <CardContent>
          {handovers.isPending ? (
            <Waiting q={handovers} />
          ) : handovers.error ? (
            <QueryErrorBox title="ما وصلت التسليمات" onRetry={() => void handovers.refetch()} />
          ) : (handovers.data ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">ما سلّمت شي بعد</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ</TH>
                  <TH>المبلغ</TH>
                  <TH>استلمه</TH>
                </TR>
              </THead>
              <TBody>
                {(handovers.data ?? []).map((h) => (
                  <TR key={h.id}>
                    <TD className="tabular-nums">{shortDate(h.date)}</TD>
                    <TD className="font-medium tabular-nums">{money(h.amount)}</TD>
                    <TD>{h.receivedBy}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  )
}

/** The site's stat card shape, with an accent top border. */
function StatTile({
  title,
  value,
  sub,
  color,
  icon,
}: {
  title: string
  value: string
  sub?: string
  color: string
  icon: React.ReactNode
}) {
  return (
    <div
      className="relative overflow-hidden rounded-lg border p-5"
      style={{
        backgroundColor: "var(--theme-cardBg)",
        borderColor: "var(--theme-cardBorder)",
        boxShadow: "0 1px 3px rgba(17,17,26,0.07)",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums">{value}</p>
          {sub ? <p className="mt-0.5 text-[12px] text-slate-500 tabular-nums">{sub}</p> : null}
        </div>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}18`, color }}
        >
          {icon}
        </div>
      </div>
    </div>
  )
}

/* ── «أكو مشكلة» ─────────────────────────────────────────────────────── */
