/**
 * كشف الحساب السريع
 * Search for any customer → show their full statement instantly.
 */
import { useMemo, useRef, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { Link } from "react-router-dom"
import { ArrowLeft, ExternalLink, Search, TrendingUp, Wallet } from "lucide-react"
import { useAllCustomers, useCustomerDetails } from "../hooks/useCustomers"
import { fmt } from "../utils/fmt"
import { formatDate, formatDateTime } from "../utils/date"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"

import type { CustomerTransaction } from "../types/api"

function auditNote(row: CustomerTransaction) {
  if (!row.lastChangedAt) return "-"
  const action = row.lastAction === "DELETE"
    ? "إلغاء"
    : row.lastAction === "REACTIVATE"
      ? "إرجاع نشطة"
      : "تعديل"
  const user = row.lastChangedByName ? ` | ${row.lastChangedByName}` : ""
  return `${action}: ${formatDateTime(row.lastChangedAt)}${user}`
}

function transactionTone(tx: CustomerTransaction) {
  const type = String(tx.type ?? "").toUpperCase()
  const status = String(tx.status ?? "").toUpperCase()
  const isPurchase = type === "INVOICE" && tx.invoiceType === "PURCHASE"
  const isReturn   = type === "INVOICE" && tx.invoiceType === "SALES_RETURN"
  const isSale     = type === "INVOICE" && tx.invoiceType === "SALE"
  const isPayment  = type === "INVOICE_PAYMENT"
  const isVoucher  = type === "RECEIPT" || type === "PAYMENT" || type === "EXPENSE"

  if (status === "CANCELLED") {
    return {
      row: "border-r-4 border-rose-500 bg-rose-50/80 hover:bg-rose-100/80",
      style: { backgroundColor: "#FFF1F2", borderRight: "4px solid #F43F5E" },
      label: "bg-rose-100 text-rose-700 border border-rose-200",
    }
  }
  if (isPurchase) {
    return {
      row: "border-r-4 border-amber-500 bg-amber-50/70 hover:bg-amber-100/70",
      style: { backgroundColor: "#FFFBEB", borderRight: "4px solid #F59E0B" },
      label: "bg-amber-100 text-amber-800 border border-amber-200",
    }
  }
  if (isReturn) {
    return {
      row: "border-r-4 border-purple-400 bg-purple-50/70 hover:bg-purple-100/70",
      style: { backgroundColor: "#FAF5FF", borderRight: "4px solid #A855F7" },
      label: "bg-purple-100 text-purple-800 border border-purple-200",
    }
  }
  if (isSale || isPayment) {
    return {
      row: "border-r-4 border-blue-500 bg-blue-50/70 hover:bg-blue-100/70",
      style: { backgroundColor: "#EFF6FF", borderRight: "4px solid #3B82F6" },
      label: "bg-blue-100 text-blue-700 border border-blue-200",
    }
  }
  if (isVoucher) {
    return {
      row: "border-r-4 border-emerald-500 bg-emerald-50/70 hover:bg-emerald-100/70",
      style: { backgroundColor: "#ECFDF5", borderRight: "4px solid #10B981" },
      label: "bg-emerald-100 text-emerald-700 border border-emerald-200",
    }
  }
  return {
    row: "border-r-4 border-slate-300 hover:bg-slate-50",
    style: { borderRight: "4px solid #CBD5E1" },
    label: "bg-slate-100 text-slate-700 border border-slate-200",
  }
}

export function AccountLookupPage() {
  usePageTitle("كشف الحساب العام")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Include all persons (customers + suppliers) with deleted history
  const allCustomersQuery = useAllCustomers()
  const customers = allCustomersQuery.data ?? []

  const suggestions = useMemo(
    () =>
      query.trim()
        ? customers
            .filter(
              (c) =>
                c.name.toLowerCase().includes(query.toLowerCase()) ||
                c.phone.includes(query),
            )
            .slice(0, 10)
        : [],
    [customers, query],
  )

  const selectedCustomer = customers.find((c) => c.id === selectedId) ?? null

  // Full details — pass includeDeleted=true so deleted customers are visible
  const details = useCustomerDetails(selectedId ?? undefined, true)
  const transactions = details.transactionsQuery.data ?? []
  const invoices = details.invoicesQuery.data ?? []
  const vouchers = details.vouchersQuery.data ?? []

  const totalSales = invoices
    .filter((i) => i.type !== "PURCHASE")
    .reduce((s, i) => s + Number(i.totalAmount ?? 0), 0)

  const totalReceipts = vouchers
    .filter((v) => v.type === "RECEIPT")
    .reduce((s, v) => s + Number(v.amount ?? 0), 0)

  function pick(id: string, name: string) {
    setSelectedId(id)
    setQuery(name)
    setDropdownOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold">كشف الحساب العام</h1>
        <p className="text-sm text-slate-500">ابحث عن أي شخص — زبون أو مورد — لعرض كامل حركاته من فواتير بيع وشراء وسندات قبض ودفع.</p>
      </div>

      {/* Search box */}
      <div className="relative max-w-md">
        <div className="flex items-center gap-2 rounded-xl border-2 border-[var(--theme-accent)] bg-white px-4 py-2.5 shadow-sm dark:bg-slate-900">
          <Search className="h-5 w-5 shrink-0 text-[var(--theme-accent)]" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-base outline-none placeholder:text-slate-400"
            placeholder="اكتب الاسم أو رقم الهاتف..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedId(null)
              setDropdownOpen(true)
            }}
            onFocus={() => setDropdownOpen(true)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          />
          {query ? (
            <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => { setQuery(""); setSelectedId(null) }}>✕</button>
          ) : null}
        </div>

        {/* Dropdown suggestions */}
        {dropdownOpen && suggestions.length > 0 ? (
          <div className="absolute z-30 mt-1 w-full rounded-xl border bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {suggestions.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-right text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c.id, c.name)}
              >
                <span className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.isBoth && (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">ز+م</span>
                  )}
                  {!c.isBoth && c.isSupplier && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">مورد</span>
                  )}
                  {c.deletedAt && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">مؤرشف</span>
                  )}
                </span>
                <span className="text-slate-500">{c.phone}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* No selection state */}
      {!selectedCustomer && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-12 text-center dark:border-slate-700">
          <Search className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-slate-500">ابحث عن أي زبون أو مورد لعرض كشف حسابه</p>
        </div>
      )}

      {/* Customer found */}
      {selectedCustomer ? (
        <div className="space-y-4">
          {/* Customer header */}
          <div
            className="rounded-xl p-5 text-white shadow-sm"
            style={{ background: `linear-gradient(135deg, var(--theme-accent), var(--theme-primaryBtn))` }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-bold">{selectedCustomer.name}</h2>
                  {selectedCustomer.isBoth && (
                    <span className="rounded-full bg-purple-200/80 px-2 py-0.5 text-xs font-bold text-purple-900">زبون ومورد</span>
                  )}
                  {!selectedCustomer.isBoth && selectedCustomer.isSupplier && (
                    <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-xs font-bold text-amber-900">مورد</span>
                  )}
                </div>
                <p className="text-sm opacity-80">{selectedCustomer.phone}</p>
                {selectedCustomer.address ? <p className="text-sm opacity-70">{selectedCustomer.address}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-lg bg-white/20 px-4 py-2 text-center backdrop-blur">
                  <div className="text-xs opacity-80">الرصيد الحالي</div>
                  <div className="text-xl font-bold">{fmt(selectedCustomer.currentBalance)}</div>
                  <div className="text-xs opacity-70">د.ع</div>
                </div>
                <Button asChild variant="outline" className="bg-white/90 hover:bg-white text-slate-900">
                  <Link to={`/customers/${selectedCustomer.id}`}>
                    <ExternalLink className="h-4 w-4" /> صفحة الحساب
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          {/* Metrics row */}
          <div className="grid gap-3 sm:grid-cols-4">
            <MetricCard title="الرصيد الافتتاحي" value={selectedCustomer.openingBalance} />
            <MetricCard title="إجمالي المبيعات" value={totalSales} icon={TrendingUp} color="text-emerald-600" />
            <MetricCard title="إجمالي القبضات" value={totalReceipts} icon={Wallet} color="text-sky-600" />
            <MetricCard title="الرصيد النهائي" value={selectedCustomer.currentBalance}
              color={selectedCustomer.currentBalance > 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"} />
          </div>

          {/* Transactions */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>كشف الحساب التفصيلي</CardTitle>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {transactions.length} حركة
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {transactions.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">لا توجد حركات</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-right dark:border-slate-700 dark:bg-slate-900">
                        <th className="px-3 py-2.5 font-semibold text-slate-600 text-xs">التاريخ</th>
                        <th className="px-3 py-2.5 font-semibold text-slate-600 text-xs">النوع / الرقم</th>
                        <th className="px-3 py-2.5 font-semibold text-slate-600 text-xs">بواسطة</th>
                        <th className="px-3 py-2.5 font-semibold text-rose-700 text-xs text-center bg-rose-50 dark:bg-rose-950/20">
                          المبلغ<br/><span className="font-normal text-[10px] text-rose-500">فاتورة / دفع</span>
                        </th>
                        <th className="px-3 py-2.5 font-semibold text-emerald-700 text-xs text-center bg-emerald-50 dark:bg-emerald-950/20">
                          تسديد<br/><span className="font-normal text-[10px] text-emerald-500">قبض / خصم</span>
                        </th>
                        <th className="px-3 py-2.5 font-semibold text-slate-700 text-xs text-center">
                          الرصيد<br/><span className="font-normal text-[10px] text-slate-400">د.ع</span>
                        </th>
                        <th className="px-2 py-2.5 w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx, idx) => {
                        const t = tx.type?.toUpperCase() ?? ""
                        const isInvoice = t === "INVOICE" || t === "INVOICE_PAYMENT"
                        const link = isInvoice ? `/invoices/${tx.id}` : `/vouchers/${tx.id}`
                        const tone = transactionTone(tx)
                        const isCancelled = tx.status === "CANCELLED"
                        const typeLabel =
                          t === "INVOICE"
                            ? tx.invoiceType === "PURCHASE" ? "فاتورة شراء"
                              : tx.invoiceType === "SALES_RETURN" ? "مرتجع بيع"
                              : "فاتورة بيع"
                            : t === "INVOICE_PAYMENT" ? "دفعة مسبقة"
                            : t === "RECEIPT" ? "سند قبض"
                            : t === "PAYMENT" ? "سند دفع"
                            : "مصاريف"
                        const label = isCancelled ? `${typeLabel} — ملغاة` : typeLabel
                        const debitAmt  = tx.debit  ?? 0
                        const creditAmt = tx.credit ?? 0
                        const balance   = Number(tx.runningBalance)
                        return (
                          <tr
                            key={`${tx.id}-${tx.referenceNumber}-${idx}`}
                            className={`border-b border-slate-100 dark:border-slate-800 ${tone.row}`}
                            style={tone.style}
                          >
                            {/* التاريخ */}
                            <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                              <div className="font-bold text-slate-800 dark:text-slate-100">{formatDate(tx.date)}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{formatDateTime(tx.createdAt)}</div>
                            </td>

                            {/* النوع والرقم */}
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${tone.label}`}>
                                {label}
                              </span>
                              <div className="mt-1 font-mono text-xs text-slate-500">{tx.referenceNumber}</div>
                            </td>

                            {/* بواسطة + آخر تغيير */}
                            <td className="px-3 py-2.5 text-[11px] text-slate-500 max-w-[120px]">
                              <div>{tx.createdByName ?? "—"}</div>
                              {auditNote(tx) !== "-" && (
                                <div className="text-[10px] text-amber-600 mt-0.5">{auditNote(tx)}</div>
                              )}
                            </td>

                            {/* المبلغ (مدين) */}
                            <td className="px-3 py-2.5 text-center font-mono bg-rose-50/40 dark:bg-rose-950/10">
                              {debitAmt > 0 ? (
                                <span className={`font-bold text-rose-700 text-sm ${isCancelled ? "line-through opacity-50" : ""}`}>
                                  {fmt(debitAmt)}
                                </span>
                              ) : (
                                <span className="text-slate-200 dark:text-slate-700 text-xs select-none">—</span>
                              )}
                            </td>

                            {/* تسديد (دائن) */}
                            <td className="px-3 py-2.5 text-center font-mono bg-emerald-50/40 dark:bg-emerald-950/10">
                              {creditAmt > 0 ? (
                                <span className={`font-bold text-emerald-700 text-sm ${isCancelled ? "line-through opacity-50" : ""}`}>
                                  {fmt(creditAmt)}
                                </span>
                              ) : (
                                <span className="text-slate-200 dark:text-slate-700 text-xs select-none">—</span>
                              )}
                            </td>

                            {/* الرصيد */}
                            <td className="px-3 py-2.5 text-center whitespace-nowrap">
                              <span className={`font-bold text-sm ${balance > 0 ? "text-rose-600" : balance < 0 ? "text-emerald-600" : "text-slate-400"}`}>
                                {fmt(Math.abs(balance))}
                              </span>
                              {balance !== 0 && (
                                <div className="text-[9px] text-slate-400 mt-0.5">
                                  {balance > 0 ? "عليه" : "له"}
                                </div>
                              )}
                            </td>

                            {/* رابط */}
                            <td className="px-2 py-2.5">
                              <Button asChild variant="ghost" size="sm" className="h-7 w-7 p-0">
                                <Link to={link}><ArrowLeft className="h-3.5 w-3.5" /></Link>
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {/* Footer totals row */}
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold dark:border-slate-600 dark:bg-slate-900">
                        <td className="px-3 py-2.5 text-xs text-slate-600" colSpan={3}>
                          الإجمالي ({transactions.filter(tx => tx.status !== "CANCELLED").length} حركة نشطة)
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-rose-700 bg-rose-50 dark:bg-rose-950/20">
                          {fmt(transactions.reduce((s, tx) => s + (tx.debit ?? 0), 0))}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20">
                          {fmt(transactions.reduce((s, tx) => s + (tx.credit ?? 0), 0))}
                        </td>
                        <td className="px-3 py-2.5 text-center font-mono">
                          <span className={`${Number(selectedCustomer.currentBalance) > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                            {fmt(Math.abs(selectedCustomer.currentBalance))}
                          </span>
                          <div className="text-[9px] text-slate-400">
                            {Number(selectedCustomer.currentBalance) > 0 ? "عليه" : "له"}
                          </div>
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function MetricCard({ title, value, icon: Icon, color }: {
  title: string; value: number
  icon?: typeof TrendingUp; color?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-slate-500 mb-1">{title}</div>
        <div className={`text-lg font-bold ${color ?? ""}`}>{fmt(value)} <span className="text-xs font-normal">د.ع</span></div>
        {Icon ? <Icon className={`mt-1 h-4 w-4 ${color}`} /> : null}
      </CardContent>
    </Card>
  )
}
