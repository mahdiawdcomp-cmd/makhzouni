import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { ArrowRight, RefreshCw } from "lucide-react"
import { getPublicInvoice, getCustomerPortal } from "../api/endpoints"

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

function unitLabel(unit: string) {
  if (unit === "PIECE") return "قطعة"
  if (unit === "CARTON") return "كرتون"
  if (unit === "DOZEN") return "دزينة"
  if (unit === "BOX") return "علبة"
  return unit
}

export function PublicInvoicePage() {
  const { token, invoiceId } = useParams()
  const query = useQuery({
    queryKey: ["public-invoice", token, invoiceId],
    queryFn: () => getPublicInvoice(token!, invoiceId!),
    enabled: Boolean(token && invoiceId),
    retry: false,
  })
  const portalQuery = useQuery({
    queryKey: ["client-portal", token],
    queryFn: () => getCustomerPortal(token!),
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    retry: false,
  })

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100" dir="rtl">
        <div className="text-center text-slate-500">
          <div className="mb-3 text-4xl">🧾</div>
          <div>جاري تحميل الفاتورة...</div>
        </div>
      </div>
    )
  }

  if (!query.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4" dir="rtl">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mb-3 text-4xl">❌</div>
          <div className="text-lg font-bold">الفاتورة غير موجودة</div>
          <p className="mt-2 text-sm text-slate-500">تحقق من الرابط أو اطلب من المحاسب رابطاً صحيحاً.</p>
          {token && (
            <Link
              to={`/client/${token}`}
              className="mt-4 inline-flex items-center gap-1 text-sm text-blue-600 underline"
            >
              <ArrowRight className="h-3 w-3" /> العودة لكشف الحساب
            </Link>
          )}
        </div>
      </div>
    )
  }

  const inv = query.data
  const isCancelled = inv.status === "CANCELLED"
  const storePhone = portalQuery.data?.storePhone ?? null
  const customerName = portalQuery.data?.customer.name ?? ""

  return (
    <div className="min-h-screen bg-slate-100 pb-8" dir="rtl">
      {/* Header */}
      <div
        className="px-4 pb-5 pt-6 text-white"
        style={{
          background: isCancelled
            ? "linear-gradient(135deg, #be123c, #9f1239)"
            : "linear-gradient(135deg, #1e293b, #334155)",
        }}
      >
        <div className="mx-auto max-w-lg">
          {token && (
            <Link
              to={`/client/${token}`}
              className="mb-3 inline-flex items-center gap-1 text-xs text-white/60 hover:text-white/90"
            >
              <ArrowRight className="h-3 w-3" /> كشف الحساب
            </Link>
          )}
          <div className="text-xs font-medium uppercase tracking-widest text-white/50">
            {typeLabel(inv.type)}
          </div>
          <h1 className="mt-0.5 text-2xl font-bold">{inv.invoiceNumber}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/70">
            <span>{formatDate(inv.date)}</span>
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs">
              {paymentLabel(inv.paymentType)}
            </span>
            {isCancelled && (
              <span className="rounded-full bg-rose-300/40 px-2.5 py-0.5 text-xs font-bold text-rose-100">
                ملغاة
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-lg space-y-3 px-3 pt-3">
        {/* Items list */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold text-slate-800">المواد ({inv.items.length})</h2>
          </div>
          <div className="divide-y">
            {inv.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-snug text-slate-800">{item.productName}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {item.quantity} {unitLabel(item.unit)} × {money(item.unitPrice)} د.ع
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-bold text-slate-800">{money(item.totalPrice)}</div>
                  <div className="text-[10px] text-slate-400">د.ع</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="divide-y">
            {inv.discount > 0 && (
              <div className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-slate-500">الخصم</span>
                <span className="text-rose-600">− {money(inv.discount)} د.ع</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-semibold">إجمالي الفاتورة</span>
              <span className="text-lg font-bold">
                {money(inv.totalAmount)}{" "}
                <span className="text-sm font-normal text-slate-500">د.ع</span>
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="text-slate-500">المبلغ المدفوع</span>
              <span className="font-semibold text-emerald-600">{money(inv.paidAmount)} د.ع</span>
            </div>
            {inv.remainingAmount > 0 ? (
              <div className="flex items-center justify-between bg-rose-50 px-4 py-3">
                <span className="font-semibold text-rose-700">المبلغ المتبقي</span>
                <span className="text-lg font-bold text-rose-600">
                  {money(inv.remainingAmount)}{" "}
                  <span className="text-sm font-normal">د.ع</span>
                </span>
              </div>
            ) : (
              <div className="flex items-center justify-between bg-emerald-50 px-4 py-3">
                <span className="font-semibold text-emerald-700">الحالة</span>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-700">
                  مسدد بالكامل ✓
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Re-order button — only for non-cancelled SALE invoices with items */}
        {!isCancelled && inv.type === "SALE" && storePhone && inv.items.length > 0 && (
          <a
            href={`https://wa.me/${storePhone.replace(/\D/g, "")}?text=${encodeURIComponent(
              `مرحبا، أنا ${customerName} أريد إعادة طلب نفس مشترياتي من الفاتورة رقم ${inv.invoiceNumber}:\n` +
              inv.items.map((i) => `- ${i.productName} × ${i.quantity} ${unitLabel(i.unit)}`).join("\n")
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-bold text-white hover:bg-emerald-600"
          >
            <RefreshCw className="h-4 w-4" />
            اطلب نفس المشتريات مرة ثانية
          </a>
        )}

        {token && (
          <div className="text-center pt-1">
            <Link to={`/client/${token}`} className="inline-flex items-center gap-1 text-sm text-slate-500 underline">
              <ArrowRight className="h-3 w-3" /> العودة لكشف الحساب
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
