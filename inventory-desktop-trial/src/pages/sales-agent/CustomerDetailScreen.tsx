import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table"
import { QueryErrorBox } from "../../components/ui/query-error"
import { cn } from "../../utils/cn"
import { money, shortDate } from "./format"
import { AgentInvoiceDialog, AgentReceiptDialog } from "./DocumentDialogs"
import type { Unit, CustomerStatement } from "./model"
import { StatusPill, Waiting } from "./ui"
import { useCustomerHeader } from "./hooks"

const TX_LABEL: Record<string, string> = {
  INVOICE: "فاتورة",
  INVOICE_PAYMENT: "دفعة على فاتورة",
  RECEIPT: "سند قبض",
  PAYMENT: "سند دفع",
  OPENING_BALANCE: "رصيد افتتاحي",
}

/**
 * «كشف الحساب» — the full account of one customer.
 *
 * These customers are the rep's responsibility and they see all of it. This
 * renders the shop's REAL statement, not a rep-flavoured summary, so the rep and
 * the owner can never argue from two different versions of one account.
 */
export function CustomerDetailScreen({
  customerId,
  onBack,
  catalogUnitPrice,
}: {
  customerId: string
  onBack: () => void
  catalogUnitPrice: (productId: string, unit: Unit, priceMode: string) => number | null
}) {
  // The row the rep tapped. An invoice row and its «دفعة على فاتورة» row share
  // an id, and both open the invoice.
  const [opened, setOpened] = useState<{ kind: "invoice" | "receipt"; id: string } | null>(null)
  // The balance and last payment the summary opens with. The same query the
  // page header uses, so the two can never show different numbers.
  const header = useCustomerHeader(customerId)
  const statement = useQuery({
    queryKey: ["sales-agent", "customer-detail", customerId],
    queryFn: async () => {
      const res = await api.get<{ data: CustomerStatement }>(
        `/sales-agent/customers/${customerId}/detail`,
      )
      return res.data.data
    },
    retry: 3,
  })

  if (statement.error) {
    return <QueryErrorBox title="ما وصل كشف الحساب" onRetry={() => void statement.refetch()} />
  }

  const rows = statement.data?.transactions ?? []
  const last = rows.length > 0 ? rows[rows.length - 1] : null

  // «الملخص» — the three things a shopkeeper argues about, before any table:
  // what he owes, when he last paid, and when he last bought.
  const balance = header.data?.currentBalance ?? last?.runningBalance ?? null
  const lastPayment = header.data?.lastPayment ?? null
  const lastSale = [...rows]
    .reverse()
    .find((r) => r.type === "INVOICE" && r.status !== "CANCELLED" && r.invoiceType !== "SALES_RETURN" && r.invoiceType !== "PURCHASE")

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>كشف حساب {statement.data?.customer.name ?? ""}</CardTitle>
          {last?.runningBalance != null && (
            <p className="mt-0.5 text-[12px] text-slate-500 tabular-nums">
              الرصيد الحالي {money(last.runningBalance)} · الافتتاحي{" "}
              {money(statement.data?.customer.openingBalance ?? 0)}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={onBack}>رجوع</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <SummaryTile
            title="الرصيد"
            value={balance == null ? "…" : money(Math.abs(balance))}
            // Positive is what the customer owes the shop, as everywhere else
            // in this app; said in words so nobody has to remember the sign.
            sub={balance == null ? undefined : balance > 0 ? "عليه" : balance < 0 ? "له" : "ماكو رصيد"}
            tone={balance != null && balance > 0 ? "owes" : "plain"}
          />
          <SummaryTile
            title="آخر دفعة"
            value={lastPayment ? money(lastPayment.amount) : "ماكو"}
            sub={lastPayment ? `${shortDate(lastPayment.date)} · ${daysAgo(lastPayment.date)}` : "ما دفع لحد الآن"}
          />
          <SummaryTile
            title="آخر فاتورة"
            value={lastSale ? money(lastSale.amount) : "ماكو"}
            sub={lastSale ? `${shortDate(lastSale.date)} · ${daysAgo(lastSale.date)}` : "ما اشترى لحد الآن"}
          />
        </div>

        {statement.isPending ? (
          <Waiting q={statement} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">ما اكو حركات</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>التاريخ</TH>
                <TH>النوع</TH>
                <TH>المرجع</TH>
                <TH>المبلغ</TH>
                <TH>الرصيد</TH>
              </TR>
            </THead>
            <TBody>
              {/* Newest first: the rep is standing in front of the shopkeeper and
                  the argument is always about the last few movements. */}
              {[...rows].reverse().map((row) => {
                // Invoices and receipts open; a «سند دفع» is the shop paying
                // the customer and is nothing a rep acts on.
                const kind = row.type === "RECEIPT" ? "receipt" : row.type === "PAYMENT" ? null : "invoice"
                return (
                  <TR
                    key={`${row.id}:${row.type}`}
                    className={cn(
                      row.status === "CANCELLED" && "opacity-60",
                      kind && "cursor-pointer hover:bg-[var(--theme-accentSoft)]",
                    )}
                    onClick={kind ? () => setOpened({ kind, id: row.id }) : undefined}
                  >
                    <TD className="tabular-nums">{shortDate(row.date)}</TD>
                    <TD>
                      {TX_LABEL[row.type] ?? row.type}
                      {row.status === "CANCELLED" && <StatusPill tone="bad">ملغية</StatusPill>}
                      {/* Which rows are the rep's to change, and which already
                          wait on the owner — visible before they tap. */}
                      {row.pending ? (
                        <StatusPill tone="wait">{row.pending === "CANCEL" ? "إلغاء بانتظار الموافقة" : "تعديل بانتظار الموافقة"}</StatusPill>
                      ) : row.mine ? (
                        <StatusPill tone="ok">{row.type === "RECEIPT" ? "سندك" : "فاتورتك"}</StatusPill>
                      ) : null}
                    </TD>
                    <TD className="tabular-nums">{row.referenceNumber}</TD>
                    <TD className="font-medium tabular-nums">{money(row.amount)}</TD>
                    <TD className="tabular-nums">
                      {row.runningBalance != null ? money(row.runningBalance) : "—"}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </CardContent>
      {opened?.kind === "invoice" && (
        <AgentInvoiceDialog invoiceId={opened.id} onClose={() => setOpened(null)} catalogUnitPrice={catalogUnitPrice} />
      )}
      {opened?.kind === "receipt" && <AgentReceiptDialog voucherId={opened.id} onClose={() => setOpened(null)} />}
    </Card>
  )
}

/** «اليوم» / «أمس» / «قبل ١٢ يوم» — how long ago, read at a glance. */
function daysAgo(value: string): string {
  const then = new Date(value)
  if (Number.isNaN(then.getTime())) return ""
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(new Date()) - start(then)) / 86_400_000)
  if (days <= 0) return "اليوم"
  if (days === 1) return "أمس"
  return `قبل ${days} يوم`
}

function SummaryTile({
  title,
  value,
  sub,
  tone = "plain",
}: {
  title: string
  value: string
  sub?: string
  tone?: "plain" | "owes"
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "owes"
          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
          : "border-[var(--theme-cardBorder)] bg-[var(--theme-cardBg)]",
      )}
    >
      <p className="text-[12px] text-slate-500">{title}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-slate-500 tabular-nums">{sub}</p>}
    </div>
  )
}
