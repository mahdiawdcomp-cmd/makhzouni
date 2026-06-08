import { useState } from "react"
import { Link } from "react-router-dom"
import {
  Bar, BarChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  useEndOfDayReport,
  useInventoryReport, useSalesReport, useTopCustomers,
} from "../hooks/useReports"
import { sendWhatsAppWeb } from "../utils/whatsapp"
import { fmt } from "../utils/fmt"
import { getProfitReport, getDebtReminderList, sendDebtReminder } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

type Tab = "sales" | "profits" | "top-customers" | "end-of-day" | "inventory" | "debts"

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: "sales",        label: "المبيعات",       emoji: "📊" },
  { id: "profits",      label: "الأرباح",         emoji: "💰" },
  { id: "top-customers",label: "أفضل الزبائن",   emoji: "🏆" },
  { id: "end-of-day",   label: "نهاية اليوم",     emoji: "🌙" },
  { id: "inventory",    label: "المخزون",         emoji: "📦" },
  { id: "debts",        label: "الديون",          emoji: "🔔" },
]

export function ReportsPage() {
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
        <MetricCard title="صافي الأرباح"   value={sales?.netProfit ?? 0} color="text-blue-600" />
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
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const report = useEndOfDayReport(date)
  const d = report.data

  const netCash = (d?.receipts.total ?? 0) - (d?.payments.total ?? 0) - (d?.expenses.total ?? 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">اليوم:</label>
        <Input type="date" className="w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {!d ? <div className="text-center text-slate-400 py-8">جاري التحميل...</div> : (
        <>
          {/* Summary metrics */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryBox title="🧾 فواتير البيع" count={d.sales.count} total={d.sales.total} collected={d.sales.collected} color="bg-emerald-50 border-emerald-200" />
            <SummaryBox title="🛒 فواتير الشراء" count={d.purchases.count} total={d.purchases.total} color="bg-amber-50 border-amber-200" />
            <SummaryBox title="💚 سندات قبض" count={d.receipts.count} total={d.receipts.total} color="bg-sky-50 border-sky-200" />
            <SummaryBox title="🔸 سندات دفع" count={d.payments.count} total={d.payments.total} color="bg-orange-50 border-orange-200" />
            <SummaryBox title="💸 مصاريف" count={d.expenses.count} total={d.expenses.total} color="bg-rose-50 border-rose-200" />
            <div className="rounded-xl border-2 border-slate-300 bg-slate-50 p-4">
              <div className="text-sm font-bold text-slate-600 mb-1">💵 صافي الكاش اليوم</div>
              <div className={`text-2xl font-extrabold ${netCash >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {fmt(netCash)} <span className="text-sm font-normal">د.ع</span>
              </div>
              <div className="text-xs text-slate-400 mt-1">قبض − دفع − مصاريف</div>
            </div>
          </div>

          {/* Today's invoices list */}
          {d.invoices.length > 0 ? (
            <Card>
              <CardHeader><CardTitle>فواتير اليوم</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <THead><TR><TH>رقم الفاتورة</TH><TH>الزبون</TH><TH>الإجمالي</TH><TH>المدفوع</TH><TH>الباقي</TH></TR></THead>
                  <TBody>
                    {d.invoices.map((inv) => (
                      <TR key={inv.invoiceNumber}>
                        <TD className="font-mono text-sm">{inv.invoiceNumber}</TD>
                        <TD>{inv.customerName}</TD>
                        <TD className="font-semibold">{fmt(inv.total)}</TD>
                        <TD className="text-emerald-600">{fmt(inv.paid)}</TD>
                        <TD className={inv.total - inv.paid > 0 ? "text-rose-600 font-semibold" : "text-slate-400"}>
                          {fmt(inv.total - inv.paid)}
                        </TD>
                      </TR>
                    ))}
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
                    <Button size="sm" variant="outline" onClick={() => sendWhatsAppWeb(r.phone, `مرحباً ${r.name}، رصيدك لدينا: ${fmt(r.currentBalance)} د.ع`)}>
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
