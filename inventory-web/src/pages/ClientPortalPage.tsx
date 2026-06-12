import { useMemo, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import { CalendarClock, ChevronLeft, FileText, ReceiptText, Wallet } from "lucide-react"
import { getCustomerPortal } from "../api/endpoints"
import { fmt } from "../utils/fmt"
import type { CustomerTransaction } from "../types/api"

function formatDate(value?: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("ar-IQ", { dateStyle: "short", timeStyle: "short" })
}

function rowColors(row: CustomerTransaction): { border: string; bg: string; badge: string } {
  const type = row.type.toUpperCase()
  if (row.status === "CANCELLED")
    return { border: "border-rose-400", bg: "bg-rose-50", badge: "bg-rose-100 text-rose-700" }
  if (type === "RECEIPT" || type === "PAYMENT")
    return { border: "border-emerald-400", bg: "bg-emerald-50", badge: "bg-emerald-100 text-emerald-700" }
  return { border: "border-sky-400", bg: "bg-sky-50", badge: "bg-sky-100 text-sky-700" }
}

function typeLabel(row: CustomerTransaction) {
  const type = row.type.toUpperCase()
  if (row.status === "CANCELLED") return "فاتورة ملغاة"
  if (type === "RECEIPT") return "سند قبض"
  if (type === "PAYMENT") return "سند دفع"
  if (type === "EXPENSE") return "مصاريف"
  if (type === "SALE") return "فاتورة بيع"
  if (type === "PURCHASE") return "فاتورة شراء"
  if (type === "SALES_RETURN") return "فاتورة مرتجع"
  if (type.includes("INVOICE")) return Number(row.debit) > 0 ? "فاتورة بيع" : Number(row.credit) > 0 ? "فاتورة شراء" : "فاتورة"
  return row.type
}

function isInvoiceRow(row: CustomerTransaction) {
  const t = row.type.toUpperCase()
  return (t === "SALE" || t === "PURCHASE" || t === "SALES_RETURN" || t.includes("INVOICE")) && row.status !== "CANCELLED"
}

export function ClientPortalPage() {
  const { token } = useParams()
  const navigate = useNavigate()
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100" dir="rtl">
        <div className="text-center text-slate-500">
          <div className="mb-3 text-4xl">📋</div>
          <div>جاري تحميل كشف الحساب...</div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4" dir="rtl">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mb-3 text-4xl">🔗</div>
          <div className="text-lg font-bold">الرابط غير صالح أو منتهي</div>
          <p className="mt-2 text-sm text-slate-500">اطلب رابطاً جديداً من المحاسب.</p>
        </div>
      </div>
    )
  }

  const balance = Number(data.customer.currentBalance)
  const isDebt = balance > 0

  return (
    <div className="min-h-screen bg-slate-100 pb-8" dir="rtl">
      {/* Header */}
      <div
        className="px-4 pb-5 pt-6 text-white"
        style={{ background: "linear-gradient(135deg, #1e293b, #334155)" }}
      >
        <div className="mx-auto max-w-lg">
          <div className="text-xs font-medium uppercase tracking-widest text-white/50">كشف حساب</div>
          <h1 className="mt-1 text-2xl font-bold">{data.customer.name}</h1>
          {data.customer.phone && (
            <p className="mt-0.5 text-sm text-white/70">{data.customer.phone}</p>
          )}
          {/* Balance pill */}
          <div className={`mt-4 inline-flex flex-col rounded-xl px-5 py-3 ${isDebt ? "bg-rose-500/90" : "bg-emerald-500/90"}`}>
            <span className="text-[11px] font-medium text-white/80">الرصيد الحالي</span>
            <span className="text-2xl font-bold">{fmt(balance)} د.ع</span>
            <span className="text-[11px] text-white/70">{isDebt ? "مبلغ مستحق عليك" : "رصيد لصالحك"}</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-lg space-y-3 px-3 pt-3">
        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2">
          <MetricCard icon={<Wallet className="h-4 w-4" />} label="رصيد افتتاحي" value={`${fmt(data.customer.openingBalance)} د.ع`} />
          <MetricCard icon={<FileText className="h-4 w-4" />} label="عدد الحركات" value={String(totals.count)} />
          <MetricCard icon={<CalendarClock className="h-4 w-4" />} label="آخر حركة" value={formatDate(data.customer.lastTransactionAt)} small />
          <MetricCard icon={<ReceiptText className="h-4 w-4" />} label="انتهاء الرابط" value={formatDate(data.expiresAt)} small />
        </div>

        {/* Transactions */}
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold text-slate-800">حركات الحساب</h2>
          </div>

          {data.transactions.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">لا توجد حركات بعد</div>
          ) : (
            <div className="divide-y">
              {data.transactions.map((row) => {
                const clickable = isInvoiceRow(row)
                const { border, bg, badge } = rowColors(row)
                const debit = Number(row.debit ?? 0)
                const credit = Number(row.credit ?? 0)
                const running = Number(row.runningBalance ?? 0)
                return (
                  <div
                    key={`${row.id}-${row.type}-${row.referenceNumber}`}
                    className={`border-r-4 ${border} ${bg} p-3 ${clickable ? "cursor-pointer active:brightness-95" : ""}`}
                    onClick={clickable ? () => navigate(`/client/${token}/invoice/${row.id}`) : undefined}
                  >
                    {/* Row 1: type badge + reference + arrow */}
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
                        {typeLabel(row)}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs text-slate-500">{row.referenceNumber}</span>
                        {clickable && <ChevronLeft className="h-3.5 w-3.5 text-slate-400" />}
                      </div>
                    </div>
                    {/* Row 2: date + running balance */}
                    <div className="mt-1.5 flex items-end justify-between">
                      <span className="text-xs text-slate-500">{formatDate(row.date)}</span>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400">الرصيد</div>
                        <div className={`text-sm font-bold ${running > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {fmt(running)}
                        </div>
                      </div>
                    </div>
                    {/* Row 3: debit / credit amounts */}
                    {(debit > 0 || credit > 0) && (
                      <div className="mt-1.5 flex gap-4 border-t border-black/5 pt-1.5 text-xs">
                        {debit > 0 && (
                          <span>مدين: <span className="font-semibold text-rose-600">{fmt(debit)}</span></span>
                        )}
                        {credit > 0 && (
                          <span>دائن: <span className="font-semibold text-emerald-600">{fmt(credit)}</span></span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="text-center text-xs text-slate-400">
          هذا الرابط للعرض فقط.{" "}
          <Link className="underline" to="/login">دخول الإدارة</Link>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, small }: {
  icon: ReactNode; label: string; value: string; small?: boolean
}) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-1 font-bold ${small ? "text-sm" : "text-base"}`}>{value}</div>
    </div>
  )
}
