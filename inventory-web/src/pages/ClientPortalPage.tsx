import { useMemo, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { CalendarClock, FileText, ReceiptText, Wallet } from "lucide-react"
import { getCustomerPortal } from "../api/endpoints"
import { Card, CardContent } from "../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { fmt } from "../utils/fmt"
import type { CustomerTransaction } from "../types/api"

function formatDate(value?: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("ar-IQ", { dateStyle: "short", timeStyle: "short" })
}

function rowStyle(row: CustomerTransaction) {
  const type = row.type.toUpperCase()
  if (row.status === "CANCELLED") return "border-r-4 border-rose-500 bg-rose-50"
  if (type.includes("INVOICE")) return "border-r-4 border-sky-500 bg-sky-50"
  return "border-r-4 border-emerald-500 bg-emerald-50"
}

function typeLabel(row: CustomerTransaction) {
  const type = row.type.toUpperCase()
  if (row.status === "CANCELLED") return "فاتورة ملغاة"
  if (type.includes("PAYMENT")) return "دفعة فاتورة"
  if (type.includes("INVOICE")) return "فاتورة"
  if (type === "RECEIPT") return "سند قبض"
  if (type === "PAYMENT") return "سند دفع"
  return row.type
}

export function ClientPortalPage() {
  const { token } = useParams()
  const query = useQuery({
    queryKey: ["client-portal", token],
    queryFn: () => getCustomerPortal(token!),
    enabled: Boolean(token),
    retry: false,
  })

  const data = query.data
  const totals = useMemo(() => {
    const rows = data?.transactions ?? []
    return {
      debit: rows.reduce((sum, row) => sum + Number(row.debit ?? 0), 0),
      credit: rows.reduce((sum, row) => sum + Number(row.credit ?? 0), 0),
      count: rows.length,
    }
  }, [data?.transactions])

  if (query.isLoading) {
    return <div className="min-h-screen bg-slate-100 p-6 text-center text-slate-500">جاري تحميل كشف الحساب...</div>
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <div className="text-lg font-bold">الرابط غير صالح أو منتهي</div>
            <p className="mt-2 text-sm text-slate-500">اطلب رابط جديد من المحاسب.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm text-slate-500">كشف حساب العميل</div>
              <h1 className="text-2xl font-bold">{data.customer.name}</h1>
              <p className="text-sm text-slate-500">{data.customer.phone}</p>
            </div>
            <div className="rounded-md bg-slate-900 px-4 py-3 text-white">
              <div className="text-xs text-white/70">الرصيد الحالي</div>
              <div className="text-2xl font-bold">{fmt(data.customer.currentBalance)}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Metric icon={<Wallet className="h-4 w-4" />} label="رصيد افتتاحي" value={fmt(data.customer.openingBalance)} />
            <Metric icon={<FileText className="h-4 w-4" />} label="عدد الحركات" value={totals.count} />
            <Metric icon={<CalendarClock className="h-4 w-4" />} label="آخر حركة" value={formatDate(data.customer.lastTransactionAt)} />
            <Metric icon={<ReceiptText className="h-4 w-4" />} label="ينتهي الرابط" value={formatDate(data.expiresAt)} />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ والوقت</TH>
                  <TH>النوع</TH>
                  <TH>الرقم</TH>
                  <TH>مدين</TH>
                  <TH>دائن</TH>
                  <TH>الرصيد</TH>
                </TR>
              </THead>
              <TBody>
                {data.transactions.map((row) => (
                  <TR key={`${row.id}-${row.type}-${row.referenceNumber}`} className={rowStyle(row)}>
                    <TD>{formatDate(row.date)}</TD>
                    <TD>
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold shadow-sm">{typeLabel(row)}</span>
                    </TD>
                    <TD>{row.referenceNumber}</TD>
                    <TD>{fmt(row.debit ?? 0)}</TD>
                    <TD>{fmt(row.credit ?? 0)}</TD>
                    <TD className="font-bold">{fmt(row.runningBalance)}</TD>
                  </TR>
                ))}
                {data.transactions.length === 0 ? (
                  <TR>
                    <TD colSpan={6} className="py-8 text-center text-slate-400">لا توجد حركات بعد</TD>
                  </TR>
                ) : null}
              </TBody>
            </Table>
          </CardContent>
        </Card>
        <div className="text-center text-xs text-slate-400">
          هذا الرابط للعرض فقط. <Link className="underline" to="/login">دخول الإدارة</Link>
        </div>
      </div>
    </div>
  )
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-bold">{value}</div>
    </div>
  )
}
