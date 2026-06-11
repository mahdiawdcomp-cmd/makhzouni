import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { getPublicInvoice } from "../api/endpoints"
import { Card, CardContent } from "../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

function money(value: number) {
  return new Intl.NumberFormat("ar-IQ").format(Math.round(value))
}

function formatDate(value?: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("ar-IQ", { dateStyle: "medium" })
}

function typeLabel(type: string) {
  if (type === "SALE") return "فاتورة بيع"
  if (type === "PURCHASE") return "فاتورة شراء"
  if (type === "SALES_RETURN") return "مرتجع مبيعات"
  return type
}

function paymentLabel(type: string) {
  if (type === "CASH") return "نقد"
  if (type === "CREDIT") return "آجل"
  if (type === "PARTIAL") return "جزئي"
  return type
}

export function PublicInvoicePage() {
  const { token, invoiceId } = useParams()
  const query = useQuery({
    queryKey: ["public-invoice", token, invoiceId],
    queryFn: () => getPublicInvoice(token!, invoiceId!),
    enabled: Boolean(token && invoiceId),
    retry: false,
  })

  if (query.isLoading) {
    return <div className="min-h-screen bg-slate-100 p-6 text-center text-slate-500">جاري تحميل الفاتورة...</div>
  }

  if (!query.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <Card className="max-w-md">
          <CardContent className="p-6 text-center">
            <div className="text-lg font-bold">الفاتورة غير موجودة</div>
            <p className="mt-2 text-sm text-slate-500">تحقق من الرابط أو اطلب من المحاسب رابطاً صحيحاً.</p>
            <Link to={`/client/${token}`} className="mt-4 inline-flex items-center gap-1 text-sm text-blue-600 underline">
              <ArrowRight className="h-3 w-3" /> العودة لكشف الحساب
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const inv = query.data
  const isCancelled = inv.status === "CANCELLED"

  return (
    <div className="min-h-screen bg-slate-100 p-4" dir="rtl">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link
          to={`/client/${token}`}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowRight className="h-4 w-4" /> العودة لكشف الحساب
        </Link>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm text-slate-500">{typeLabel(inv.type)}</div>
              <h1 className="text-2xl font-bold">{inv.invoiceNumber}</h1>
              <div className="mt-1 text-sm text-slate-500">{formatDate(inv.date)}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {isCancelled ? (
                <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-bold text-rose-700">ملغاة</span>
              ) : (
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">نشطة</span>
              )}
              <span className="text-xs text-slate-400">{paymentLabel(inv.paymentType)}</span>
            </div>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>المادة</TH>
                  <TH>الكود</TH>
                  <TH>العدد</TH>
                  <TH>سعر الوحدة</TH>
                  <TH>الإجمالي</TH>
                </TR>
              </THead>
              <TBody>
                {inv.items.map((item) => (
                  <TR key={item.id}>
                    <TD className="font-medium">{item.productName}</TD>
                    <TD className="text-xs text-slate-500">{item.itemNumber ?? "-"}</TD>
                    <TD>{item.quantity} {item.unit === "PIECE" ? "قطعة" : item.unit}</TD>
                    <TD>{money(item.unitPrice)}</TD>
                    <TD className="font-bold">{money(item.totalPrice)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <div className="space-y-2 text-sm">
            {inv.discount > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">الخصم</span>
                <span>{money(inv.discount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <span>الإجمالي</span>
              <span>{money(inv.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">المدفوع</span>
              <span className="text-emerald-600">{money(inv.paidAmount)}</span>
            </div>
            {inv.remainingAmount > 0 && (
              <div className="flex justify-between font-semibold text-rose-600">
                <span>المتبقي</span>
                <span>{money(inv.remainingAmount)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
