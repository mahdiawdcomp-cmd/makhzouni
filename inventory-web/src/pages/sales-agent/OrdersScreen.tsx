import { useQuery } from "@tanstack/react-query"
import { api } from "../../api/client"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table"
import { QueryErrorBox } from "../../components/ui/query-error"
import { money, shortDate } from "./format"
import type { AgentOrder } from "./model"
import { StatusPill, Waiting } from "./ui"

const ORDER_STATUS: Record<string, { label: string; tone: "ok" | "wait" | "bad" }> = {
  PENDING: { label: "بانتظار الموافقة", tone: "wait" },
  APPROVED: { label: "تمت الموافقة", tone: "ok" },
  REJECTED: { label: "مرفوض", tone: "bad" },
}

export function OrdersScreen() {
  const orders = useQuery({
    queryKey: ["sales-agent", "orders"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentOrder[] }>("/sales-agent/orders")
      return res.data.data ?? []
    },
    retry: 3,
  })

  if (orders.error) return <QueryErrorBox title="ما وصلت الطلبات" onRetry={() => void orders.refetch()} />

  const rows = orders.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>طلباتي</CardTitle>
        <span className="text-[12px] text-slate-500 tabular-nums">{rows.length} طلب</span>
      </CardHeader>
      <CardContent>
        {orders.isPending ? (
          <Waiting q={orders} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">ما عندك طلبات بعد</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>الزبون</TH>
                <TH>المبلغ</TH>
                <TH>الأسطر</TH>
                <TH>التاريخ</TH>
                <TH>الحالة</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((o) => {
                const s = ORDER_STATUS[o.status] ?? { label: o.status, tone: "muted" as const }
                return (
                  <TR key={o.id}>
                    <TD className="font-medium">{o.customerName}</TD>
                    <TD className="font-medium tabular-nums">{money(o.total)}</TD>
                    <TD className="tabular-nums">{o.lineCount}</TD>
                    <TD className="tabular-nums">{shortDate(o.createdAt)}</TD>
                    <TD>
                      <StatusPill tone={s.tone as "ok" | "wait" | "bad"}>{s.label}</StatusPill>
                      {/* Without the reason the rep sees a bare «مرفوض» and has
                          to telephone to find out what to change. */}
                      {o.reviewNote && (
                        <p className="mt-1 text-[12px] text-red-600 dark:text-red-400">
                          السبب: {o.reviewNote}
                        </p>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/* ── money ───────────────────────────────────────────────────────────── */
