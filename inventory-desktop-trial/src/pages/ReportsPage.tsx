import { useState } from "react"
import { Link } from "react-router-dom"
import { usePageTitle } from "../hooks/usePageTitle"
import {
  Bar, BarChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  useEndOfDayReport,
  useInventoryReport, useSalesReport, useTopCustomers,
} from "../hooks/useReports"
import { normalizePhone } from "../utils/whatsapp"
import { localDateStr } from "../utils/date"
import { fmt } from "../utils/fmt"
import { getProfitReport, getDebtReminderList, sendDebtReminder, sendWhatsAppMessage, getInvoices, getVouchers } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { toast } from "../components/ui/use-toast"

type Tab = "sales" | "profits" | "top-customers" | "end-of-day" | "inventory" | "debts" | "archive"

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: "sales",        label: "المبيعات",       emoji: "📊" },
  { id: "profits",      label: "الأرباح",         emoji: "💰" },
  { id: "top-customers",label: "أفضل الزبائن",   emoji: "🏆" },
  { id: "end-of-day",   label: "نهاية اليوم",     emoji: "🌙" },
  { id: "inventory",    label: "المخزون",         emoji: "📦" },
  { id: "debts",        label: "الديون",          emoji: "🔔" },
  { id: "archive",      label: "الأرشيف",         emoji: "🗄️" },
]

export function ReportsPage() {
  usePageTitle("التقارير")
  const [tab, setTab] = useState<Tab>("sales")

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">التقارير</h1>
        <p className="text-slate-500">تحليل شامل للمبيعات والأرباح والزبائن.</p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              tab === t.id
                ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            <span>{t.emoji}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sales"         && <SalesTab />}
      {tab === "profits"       && <ProfitsTab />}
      {tab === "top-customers" && <TopCustomersTab />}
      {tab === "end-of-day"    && <EndOfDayTab />}
      {tab === "inventory"     && <InventoryTab />}
      {tab === "debts"         && <DebtsTab />}
      {tab === "archive"       && <ArchiveTab />}
    </div>
  )
}

// ─── Sales Tab ───────────────────────────────────────────────────────────────
function SalesTab() {
  const [from, setFrom] = useState("")
  const [to, setTo]     = useState("")
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("day")
  const report = useSalesReport({ from: from || undefined, to: to || undefined, groupBy })
  const sales = report.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-auto" value={to}   onChange={(e) => setTo(e.target.value)} />
        <div className="flex gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} type="button" onClick={() => setGroupBy(g)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${groupBy === g ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
              {g === "day" ? "يومي" : g === "week" ? "أسبوعي" : "شهري"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="إجمالي المبيعات" value={sales?.totalSales ?? 0} color="text-emerald-600" />
        <MetricCard title="عدد الفواتير"    value={sales?.invoiceCount ?? 0} suffix="" />
        <MetricCard title="إجمالي الأرباح"  value={sales?.grossProfit ?? 0} color="text-blue-600" />
      </div>

      <Card>
        <CardHeader><CardTitle>إيرادات الفترة</CardTitle></CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sales?.chart ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => fmt(v)} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Bar dataKey="totalSales" fill="var(--theme-accent, #f59e0b)" name="المبيعات" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Profits Tab ─────────────────────────────────────────────────────────────
function ProfitsTab() {
  const [from, setFrom] = useState("")
  const [to, setTo]     = useState("")
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("month")

  const report = useQuery({
    queryKey: ["profit-report", from, to, groupBy],
    queryFn: () => getProfitReport({ from: from || undefined, to: to || undefined, groupBy }),
  })
  const data = report.data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-auto" value={to}   onChange={(e) => setTo(e.target.value)} />
        <div className="flex gap-1 rounded-lg border p-0.5 dark:border-slate-700">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} type="button" onClick={() => setGroupBy(g)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${groupBy === g ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "hover:bg-slate-100"}`}>
              {g === "day" ? "يومي" : g === "week" ? "أسبوعي" : "شهري"}
            </button>
          ))}
        </div>
      </div>

      {!data?.summary.totalRevenue && !data?.summary.totalCost ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 dark:bg-amber-950 dark:border-amber-800">
          <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">⚠️ لعرض الأرباح الدقيقة، أضف <strong>سعر الكلفة</strong> لكل منتج في صفحة المنتج.</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <MetricCard title="إجمالي الإيراد" value={data?.summary.totalRevenue ?? 0} />
        <MetricCard title="إجمالي التكلفة" value={data?.summary.totalCost ?? 0} color="text-rose-600" />
        <MetricCard title="صافي الربح" value={data?.summary.totalProfit ?? 0} color="text-emerald-600" />
        <MetricCard title="متوسط هامش الربح" value={data?.summary.avgMargin ?? 0} suffix="%" color="text-blue-600" />
      </div>

      {(data?.periods?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle>منحنى الأرباح</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.periods ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => fmt(v)} />
                <Tooltip formatter={(v) => fmt(Number(v))} />
                <Bar dataKey="revenue" fill="#6366f1" name="الإيراد" />
                <Bar dataKey="profit" fill="#10b981" name="الربح" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {(data?.topProducts?.length ?? 0) > 0 && (
        <Card>
          <CardHeader><CardTitle>أكثر المنتجات ربحاً</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <THead><TR><TH>المنتج</TH><TH>الإيراد</TH><TH>التكلفة</TH><TH>الربح</TH><TH>الهامش %</TH></TR></THead>
              <TBody>
                {data?.topProducts.map((p: { id: string; name: string; revenue: number; cost: number; profit: number; margin: number }) => (
                  <TR key={p.id}>
                    <TD className="font-medium">{p.name}</TD>
                    <TD>{fmt(p.revenue)}</TD>
                    <TD className="text-rose-600">{fmt(p.cost)}</TD>
                    <TD className={p.profit >= 0 ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>{fmt(p.profit)}</TD>
                    <TD className="text-blue-600">{p.margin}%</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Top Customers Tab ───────────────────────────────────────────────────────
function TopCustomersTab() {
  const [from, setFrom] = useState("")
  const [to, setTo]     = useState("")
  const report = useTopCustomers({ from: from || undefined, to: to || undefined, limit: 20 })
  const rows = report.data ?? []
  const total = rows.reduce((s, r) => s + r.totalPurchases, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="date" className="w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-auto" value={to}   onChange={(e) => setTo(e.target.value)} />
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>🏆 أفضل الزبائن (مبيعات)</CardTitle>
            <span className="text-sm text-slate-500">الإجمالي: {fmt(total)} د.ع</span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>#</TH><TH>الزبون</TH><TH>الهاتف</TH><TH>عدد الفواتير</TH><TH>إجمالي المشتريات</TH><TH>المدفوع</TH><TH>الرصيد</TH><TH></TH></TR></THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={r.customerId} className={i < 3 ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}>
                  <TD>
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      i === 0 ? "bg-yellow-400 text-yellow-900" :
                      i === 1 ? "bg-slate-300 text-slate-700" :
                      i === 2 ? "bg-amber-600 text-white" : "text-slate-400"
                    }`}>{i + 1}</span>
                  </TD>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-slate-500">{r.phone}</TD>
                  <TD className="text-center">{r.invoiceCount}</TD>
                  <TD className="font-bold text-emerald-700">{fmt(r.totalPurchases)}</TD>
                  <TD>{fmt(r.totalPaid)}</TD>
                  <TD className={r.currentBalance > 0 ? "text-rose-600 font-semibold" : "text-emerald-600"}>
                    {fmt(r.currentBalance)}
                  </TD>
                  <TD>
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/customers/${r.customerId}`}>كشف</Link>
                    </Button>
                  </TD>
                </TR>
              ))}
              {rows.length === 0 ? <TR><TD colSpan={8} className="py-6 text-center text-slate-400">لا توجد بيانات</TD></TR> : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── End of Day Tab ───────────────────────────────────────────────────────────
function EndOfDayTab() {
  const today = localDateStr()
  const [date, setDate] = useState(today)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [closedAt, setClosedAt] = useState<string | null>(() => {
    try { return localStorage.getItem(`registerClose_${localDateStr()}`) } catch { return null }
  })
  const report = useEndOfDayReport(date)
  const d = report.data

  // صافي الصندوق = كاش محصّل من الفواتير + سندات القبض − سندات الدفع − المصاريف
  const netCash = (d?.sales.collected ?? 0) + (d?.receipts.total ?? 0) - (d?.payments.total ?? 0) - (d?.expenses.total ?? 0)

  function handleCloseRegister() {
    const now = new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })
    try { localStorage.setItem(`registerClose_${today}`, now) } catch {}
    setClosedAt(now)
    setShowCloseDialog(false)
    window.print()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">اليوم:</label>
          <Input type="date" className="w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {date === today ? (
          closedAt ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700">
              ✅ تم إغلاق الكاشير اليوم الساعة {closedAt}
            </div>
          ) : (
            <Button
              variant="outline"
              className="border-rose-200 text-rose-700 hover:bg-rose-50"
              onClick={() => setShowCloseDialog(true)}
            >
              🔒 إغلاق الكاشير
            </Button>
          )
        ) : null}
      </div>

      {/* Register close confirmation dialog */}
      {showCloseDialog && d ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h3 className="mb-1 text-lg font-bold">إغلاق الكاشير 🔒</h3>
            <p className="mb-4 text-sm text-slate-500">تأكيد إغلاق يوم {date} وطباعة ملخص اليوم.</p>
            <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <Row label="💵 مبيعات نقدية" val={fmt((d.sales as any).cashTotal ?? 0)} />
              <Row label="📋 مبيعات آجلة" val={fmt((d.sales as any).creditTotal ?? 0)} />
              <Row label="إجمالي البيع" val={fmt(d.sales.total)} />
              <Row label="محصّل" val={fmt(d.sales.collected)} />
              <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
                <Row label="سندات قبض" val={fmt(d.receipts.total)} />
                <Row label="سندات دفع" val={fmt(d.payments.total)} />
                <Row label="مصاريف" val={fmt(d.expenses.total)} />
              </div>
              <div className="border-t border-slate-200 pt-2 dark:border-slate-700">
                <Row label="💰 صافي الصندوق" val={fmt(netCash)} bold />
              </div>
            </div>
            <div className="flex gap-3">
              <Button className="flex-1" onClick={handleCloseRegister}>تأكيد وطباعة</Button>
              <Button variant="outline" className="flex-1" onClick={() => setShowCloseDialog(false)}>إلغاء</Button>
            </div>
          </div>
        </div>
      ) : null}

      {!d ? <div className="text-center text-slate-400 py-8">جاري التحميل...</div> : (
        <>
          {/* Cash vs Credit banner */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
              <div className="text-xs font-semibold text-emerald-700 mb-0.5">💵 مبيعات نقدية</div>
              <div className="text-xl font-extrabold text-emerald-800">{fmt((d.sales as any).cashTotal ?? 0)}</div>
              <div className="text-xs text-emerald-600 mt-0.5">{(d.sales as any).cashCount ?? 0} فاتورة كاش</div>
            </div>
            <div className="rounded-xl border-2 border-sky-300 bg-sky-50 p-4">
              <div className="text-xs font-semibold text-sky-700 mb-0.5">📋 مبيعات آجلة</div>
              <div className="text-xl font-extrabold text-sky-800">{fmt((d.sales as any).creditTotal ?? 0)}</div>
              <div className="text-xs text-sky-600 mt-0.5">{(d.sales as any).creditCount ?? 0} فاتورة ذمة</div>
            </div>
            <div className={`rounded-xl border-2 p-4 ${netCash >= 0 ? "border-slate-300 bg-slate-50" : "border-rose-300 bg-rose-50"}`}>
              <div className="text-xs font-semibold text-slate-600 mb-0.5">💰 صافي الصندوق</div>
              <div className={`text-xl font-extrabold ${netCash >= 0 ? "text-slate-800" : "text-rose-700"}`}>
                {fmt(netCash)}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">محصّل + قبض − دفع − مصاريف</div>
            </div>
          </div>

          {/* Summary metrics */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryBox title="🧾 فواتير البيع" count={d.sales.count} total={d.sales.total} collected={d.sales.collected} color="bg-emerald-50 border-emerald-200" />
            <SummaryBox title="🛒 فواتير الشراء" count={d.purchases.count} total={d.purchases.total} color="bg-amber-50 border-amber-200" />
            <SummaryBox title="💚 سندات قبض" count={d.receipts.count} total={d.receipts.total} color="bg-sky-50 border-sky-200" />
            <SummaryBox title="🔸 سندات دفع" count={d.payments.count} total={d.payments.total} color="bg-orange-50 border-orange-200" />
            <SummaryBox title="💸 مصاريف" count={d.expenses.count} total={d.expenses.total} color="bg-rose-50 border-rose-200" />
          </div>

          {/* Today's invoices list */}
          {d.invoices.length > 0 ? (
            <Card>
              <CardHeader><CardTitle>فواتير اليوم</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <THead><TR><TH>رقم الفاتورة</TH><TH>الزبون</TH><TH>النوع</TH><TH>الإجمالي</TH><TH>المدفوع</TH><TH>الباقي</TH></TR></THead>
                  <TBody>
                    {d.invoices.map((inv) => {
                      const remaining = inv.total - inv.paid
                      const ptLabel = (inv as any).paymentType === "CASH" ? "نقدي" : (inv as any).paymentType === "CHEQUE" ? "شيك" : (inv as any).paymentType === "TRANSFER" ? "تحويل" : "آجل"
                      const ptColor = (inv as any).paymentType === "CASH" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
                      return (
                        <TR key={inv.invoiceNumber} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <TD className="font-mono text-sm">
                            {(inv as any).id ? (
                              <Link to={`/invoices/${(inv as any).id}`} className="text-indigo-600 hover:underline font-semibold">{inv.invoiceNumber}</Link>
                            ) : inv.invoiceNumber}
                          </TD>
                          <TD>{inv.customerName}</TD>
                          <TD><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ptColor}`}>{ptLabel}</span></TD>
                          <TD className="font-semibold">{fmt(inv.total)}</TD>
                          <TD className="text-emerald-600">{fmt(inv.paid)}</TD>
                          <TD className={remaining > 0 ? "text-rose-600 font-semibold" : "text-slate-400"}>
                            {fmt(remaining)}
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}

// ─── Inventory Tab ────────────────────────────────────────────────────────────
function InventoryTab() {
  const report = useInventoryReport()
  const data = report.data
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard title="إجمالي قيمة الشراء" value={data?.totals.purchaseValue ?? 0} />
        <MetricCard title="إجمالي قيمة البيع"  value={data?.totals.saleValue ?? 0} color="text-emerald-600" />
      </div>
      <Card>
        <CardHeader><CardTitle>تفصيل قيمة المخزون</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>الآيتم</TH><TH>الاسم</TH><TH>الفئة</TH><TH>الكمية</TH><TH>قيمة الشراء</TH><TH>قيمة البيع</TH></TR></THead>
            <TBody>
              {(data?.products ?? []).map((p) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs">{p.itemNumber}</TD>
                  <TD className="font-medium">{p.name}</TD>
                  <TD className="text-slate-500">{p.category}</TD>
                  <TD>{fmt(p.currentStock)}</TD>
                  <TD className="text-rose-600">{fmt(p.purchaseValue)}</TD>
                  <TD className="text-emerald-600 font-semibold">{fmt(p.saleValue)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Debts Tab ────────────────────────────────────────────────────────────────
function DebtsTab() {
  const [minDays, setMinDays] = useState(0)
  const [customDays, setCustomDays] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sendMsg, setSendMsg] = useState("")

  const effectiveDays = customDays !== "" ? Number(customDays) : minDays

  const reminderQ = useQuery({
    queryKey: ["debt-reminder-list", effectiveDays],
    queryFn: () => getDebtReminderList(effectiveDays),
  })
  const rows = [...(reminderQ.data ?? [])].sort((a, b) => b.currentBalance - a.currentBalance)

  const sendMut = useMutation({
    mutationFn: () => sendDebtReminder({ customerIds: Array.from(selected), minDays: effectiveDays }),
    onSuccess: (d) => setSendMsg(`✓ تم الإرسال لـ ${d.sent} زبون${d.failed > 0 ? ` / فشل ${d.failed}` : ""}`),
    onError: () => setSendMsg("✗ فشل الإرسال"),
  })

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set())
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">أقدم من:</span>
        {[0, 7, 14, 30, 60].map((days) => (
          <Button key={days} size="sm" variant={effectiveDays === days && customDays === "" ? "default" : "outline"}
            onClick={() => { setMinDays(days); setCustomDays("") }}>
            {days === 0 ? "الكل" : `${days} يوم`}
          </Button>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="number" min={0} placeholder="عدد مخصص"
            className="w-24 rounded-md border px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
          />
          <span className="text-xs text-slate-400">يوم</span>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <span className="text-sm font-medium">{selected.size} مختار من {rows.length}</span>
          <Button size="sm"
            onClick={() => { setSendMsg(""); sendMut.mutate() }}
            disabled={selected.size === 0 || sendMut.isPending}>
            📲 {sendMut.isPending ? "جاري الإرسال..." : `إرسال واتساب للمختارين`}
          </Button>
          {sendMsg && (
            <span className={`text-sm font-medium ${sendMsg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>
              {sendMsg}
            </span>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>🔔 الديون المستحقة</CardTitle>
            <span className="text-sm font-semibold text-rose-600">
              إجمالي: {fmt(rows.reduce((s, r) => s + r.currentBalance, 0))} د.ع
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>
                  <input type="checkbox" checked={selected.size === rows.length && rows.length > 0}
                    onChange={(e) => toggleAll(e.target.checked)} />
                </TH>
                <TH>الاسم</TH><TH>الرصيد</TH><TH>آخر تعامل</TH><TH>عمر الدين</TH><TH>واتساب</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </TD>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="font-bold text-rose-600">{fmt(r.currentBalance)}</TD>
                  <TD className="text-slate-500 text-xs">{r.lastTransactionAt?.slice(0, 10) ?? "-"}</TD>
                  <TD>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.debtAgeDays > 30 ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                      r.debtAgeDays > 14 ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" :
                      "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                    }`}>{r.debtAgeDays} يوم</span>
                  </TD>
                  <TD>
                    <Button size="sm" variant="outline" onClick={() => {
                      void sendWhatsAppMessage({ phone: normalizePhone(r.phone), message: `مرحباً ${r.name}، رصيدك لدينا: ${fmt(r.currentBalance)} د.ع` })
                        .then(() => toast({ title: `✓ تم إرسال التذكير لـ ${r.name}` }))
                        .catch(() => toast({ title: "✗ تعذر الإرسال", variant: "destructive" }))
                    }}>
                      فردي
                    </Button>
                  </TD>
                </TR>
              ))}
              {rows.length === 0 ? <TR><TD colSpan={6} className="py-6 text-center text-slate-400">لا توجد ديون في هذه الفترة</TD></TR> : null}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────
function MetricCard({ title, value, color, suffix = " د.ع" }: { title: string; value: number | string; color?: string; suffix?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-slate-500">{title}</div>
        <div className={`text-2xl font-bold mt-1 ${color ?? ""}`}>
          {typeof value === "number" ? fmt(value) : value}{suffix}
        </div>
      </CardContent>
    </Card>
  )
}

function Row({ label, val, bold }: { label: string; val: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? "font-bold text-base" : ""}`}>
      <span className="text-slate-500">{label}</span>
      <span>{val}</span>
    </div>
  )
}

function SummaryBox({ title, count, total, collected, color }: {
  title: string; count: number; total: number; collected?: number; color: string
}) {
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm">{title}</span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-bold">{count} حركة</span>
      </div>
      <div className="text-xl font-extrabold">{fmt(total)} <span className="text-xs font-normal">د.ع</span></div>
      {collected !== undefined ? (
        <div className="text-xs text-slate-600 mt-0.5">محصّل: {fmt(collected)} د.ع</div>
      ) : null}
    </div>
  )
}

// ─── Archive Tab ─────────────────────────────────────────────────────────────
function ArchiveTab() {
  const [subTab, setSubTab] = useState<"invoices" | "vouchers">("invoices")

  const invoicesQuery = useQuery({
    queryKey: ["invoices", "cancelled"],
    queryFn: () => getInvoices({ status: "CANCELLED", limit: 200 }),
    enabled: subTab === "invoices",
  })

  const vouchersQuery = useQuery({
    queryKey: ["vouchers", "cancelled"],
    queryFn: () => getVouchers({ showCancelled: true, limit: 200 }),
    enabled: subTab === "vouchers",
  })

  const cancelledInvoices = (invoicesQuery.data ?? []).filter((inv) => inv.status === "CANCELLED")
  const cancelledVouchers = (vouchersQuery.data ?? []).filter((v) => v.cancelledAt)

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSubTab("invoices")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${subTab === "invoices" ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
        >
          الفواتير الملغاة ({invoicesQuery.data ? cancelledInvoices.length : "..."})
        </button>
        <button
          type="button"
          onClick={() => setSubTab("vouchers")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${subTab === "vouchers" ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"}`}
        >
          السندات المعطلة ({vouchersQuery.data ? cancelledVouchers.length : "..."})
        </button>
      </div>

      {subTab === "invoices" && (
        <Card>
          <CardHeader><CardTitle>الفواتير الملغاة</CardTitle></CardHeader>
          <CardContent>
            {invoicesQuery.isLoading && <div className="py-4 text-center text-sm text-slate-400">جاري التحميل...</div>}
            {!invoicesQuery.isLoading && (
              <Table>
                <THead>
                  <TR>
                    <TH>رقم الفاتورة</TH>
                    <TH>الزبون</TH>
                    <TH>التاريخ</TH>
                    <TH>المبلغ</TH>
                    <TH>الحالة</TH>
                    <TH>عرض</TH>
                  </TR>
                </THead>
                <TBody>
                  {cancelledInvoices.length === 0 && (
                    <TR><TD colSpan={6} className="py-6 text-center text-sm text-slate-500">لا توجد فواتير ملغاة.</TD></TR>
                  )}
                  {cancelledInvoices.map((inv) => (
                    <TR key={inv.id}>
                      <TD>{inv.invoiceNumber}</TD>
                      <TD>{inv.customer?.name ?? "-"}</TD>
                      <TD>{String(inv.date).slice(0, 10)}</TD>
                      <TD>{Number(inv.totalAmount).toLocaleString("en-US")}</TD>
                      <TD><span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">ملغاة</span></TD>
                      <TD>
                        <Link to={`/invoices/${inv.id}`} className="text-sm text-blue-600 hover:underline">عرض</Link>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {subTab === "vouchers" && (
        <Card>
          <CardHeader><CardTitle>السندات المعطلة</CardTitle></CardHeader>
          <CardContent>
            {vouchersQuery.isLoading && <div className="py-4 text-center text-sm text-slate-400">جاري التحميل...</div>}
            {!vouchersQuery.isLoading && (
              <Table>
                <THead>
                  <TR>
                    <TH>رقم السند</TH>
                    <TH>النوع</TH>
                    <TH>الزبون / الوصف</TH>
                    <TH>المبلغ</TH>
                    <TH>تاريخ التعطيل</TH>
                    <TH>عرض</TH>
                  </TR>
                </THead>
                <TBody>
                  {cancelledVouchers.length === 0 && (
                    <TR><TD colSpan={6} className="py-6 text-center text-sm text-slate-500">لا توجد سندات معطلة.</TD></TR>
                  )}
                  {cancelledVouchers.map((v) => (
                    <TR key={v.id}>
                      <TD>{v.voucherNumber}</TD>
                      <TD>{v.type === "RECEIPT" ? "قبض" : v.type === "PAYMENT" ? "دفع" : "مصاريف"}</TD>
                      <TD>{v.customer?.name ?? v.description ?? "—"}</TD>
                      <TD>{Number(v.amount).toLocaleString("en-US")}</TD>
                      <TD>{v.cancelledAt ? String(v.cancelledAt).slice(0, 10) : "—"}</TD>
                      <TD>
                        <Link to={`/vouchers/${v.id}`} className="text-sm text-blue-600 hover:underline">عرض</Link>
                      </TD>
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
