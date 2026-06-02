import { useState, type ComponentType } from "react"
import { Link } from "react-router-dom"
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronUp,
  FileText,
  Receipt,
  ReceiptText,
  Search,
  ShoppingCart,
  Wallet,
} from "lucide-react"
import { useDashboardReport, useDebtReport, useInventoryReport } from "../hooks/useReports"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

interface QuickAction {
  label: string
  to: string
  Icon: ComponentType<{ className?: string }>
  color: string // background gradient
}

const quickActions: QuickAction[] = [
  { label: "فاتورة بيع",   to: "/invoices?type=SALE",      Icon: Receipt,      color: "from-emerald-500 to-emerald-600" },
  { label: "فاتورة شراء",  to: "/invoices?type=PURCHASE",  Icon: ShoppingCart, color: "from-amber-500 to-amber-600" },
  { label: "سند قبض",      to: "/vouchers?action=RECEIPT", Icon: ReceiptText,  color: "from-sky-500 to-sky-600" },
  { label: "سند دفع",      to: "/vouchers?action=PAYMENT", Icon: ReceiptText,  color: "from-orange-500 to-orange-600" },
  { label: "مصاريف",       to: "/vouchers?action=EXPENSE", Icon: Wallet,       color: "from-rose-500 to-rose-600" },
  { label: "كشف حساب",     to: "/account",                 Icon: Search,       color: "from-purple-500 to-purple-600" },
]

export function DashboardPage() {
  const dashboard = useDashboardReport()
  const inventory = useInventoryReport()
  const debts = useDebtReport({})
  const report = dashboard.data
  const inventoryRows = inventory.data?.products ?? []
  const categoryData = Object.values(
    inventoryRows.reduce<Record<string, { category: string; value: number }>>((acc, product) => {
      const cat = product.category || "—"
      acc[cat] ??= { category: cat, value: 0 }
      acc[cat].value += product.saleValue
      return acc
    }, {}),
  )
  const topCustomers = [...(debts.data ?? [])].slice(0, 5)

  const [statsOpen, setStatsOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الرئيسية</h1>
        <p className="text-slate-500">اختصارات سريعة لأكثر العمليات استخداماً.</p>
      </div>

      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {quickActions.map(({ label, to, Icon, color }) => (
          <Link
            key={to}
            to={to}
            className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${color} p-5 text-white shadow-sm transition hover:shadow-lg hover:-translate-y-0.5`}
          >
            <div className="flex items-center gap-3">
              <Icon className="h-7 w-7 opacity-90" />
              <span className="font-semibold">{label}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Toggle for stats */}
      <button
        type="button"
        onClick={() => setStatsOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        <span className="flex items-center gap-2">
          {statsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {statsOpen ? "إخفاء الإحصائيات" : "عرض إحصائيات اليوم والمبيعات"}
        </span>
        <span className="text-xs text-slate-500">
          {statsOpen ? "اضغط لإخفائها مرة أخرى" : "مخفية افتراضياً للتركيز على العمل"}
        </span>
      </button>

      {statsOpen ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric title="مبيعات اليوم" value={report?.todaySales ?? 0} icon={Wallet}
              link={`/invoices?type=SALE&from=${new Date().toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}`} />
            <Metric title="فواتير اليوم" value={report?.todayInvoices ?? 0} icon={FileText}
              link={`/invoices?from=${new Date().toISOString().slice(0,10)}&to=${new Date().toISOString().slice(0,10)}`} />
            <Metric title="إجمالي الديون" value={report?.totalDebts ?? 0} icon={AlertTriangle}
              link="/customers" />
            <Metric title="منتجات ناقصة" value={report?.lowStockProducts ?? 0} icon={Boxes}
              link="/inventory/low-stock" />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>مبيعات آخر 7 أيام</CardTitle></CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={report?.lastSevenDaysSales ?? []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="totalSales" stroke="#0f172a" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>توزيع المبيعات بالفئات</CardTitle></CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categoryData} dataKey="value" nameKey="category" outerRadius={100} label>
                      {categoryData.map((_, index) => <Cell key={index} fill={["#4285F4", "#34A853", "#FBBC05", "#EA4335", "#9C27B0"][index % 5]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>أفضل 10 منتجات مبيعاً</CardTitle></CardHeader>
              <CardContent>
                <Table><THead><TR><TH>المنتج</TH><TH>الكمية</TH><TH>المبيعات</TH></TR></THead><TBody>{(report?.topProductsThisMonth ?? []).slice(0, 10).map((product) => <TR key={product.productId}><TD>{product.productName}</TD><TD>{product.quantitySold}</TD><TD>{product.totalSales}</TD></TR>)}</TBody></Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>أعلى 5 زبائن ديوناً</CardTitle></CardHeader>
              <CardContent>
                <Table><THead><TR><TH>الزبون</TH><TH>المبلغ</TH><TH>آخر تعامل</TH></TR></THead><TBody>{topCustomers.map((customer) => <TR key={customer.id}><TD>{customer.name}</TD><TD>{customer.currentBalance}</TD><TD>{customer.lastTransactionAt?.slice(0, 10) ?? "-"}</TD></TR>)}</TBody></Table>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Metric({ title, value, icon: Icon, link }: { title: string; value: number; icon: ComponentType<{ className?: string }>; link?: string }) {
  const content = (
    <CardContent className={`flex items-center justify-between p-5 ${link ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900 transition rounded-lg" : ""}`}>
      <div>
        <div className="text-sm text-slate-500">{title}</div>
        <div className="text-2xl font-bold">{value.toLocaleString("en-US")}</div>
        {link ? <div className="mt-0.5 text-xs text-slate-400">اضغط للعرض</div> : null}
      </div>
      <Icon className="h-8 w-8 text-amber-500" />
    </CardContent>
  )
  return link ? (
    <Card><Link to={link}>{content}</Link></Card>
  ) : (
    <Card>{content}</Card>
  )
}
