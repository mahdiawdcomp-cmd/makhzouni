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
      <CardContent>
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
