import { useState, type ComponentType } from "react"
import { Link } from "react-router-dom"
import { PendingOrdersBanner } from "../components/dashboard/PendingOrdersBanner"
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
  Globe,
  Phone,
  Receipt,
  ReceiptText,
  Search,
  Settings2,
  ShoppingCart,
  ScanBarcode,
  UserCheck,
  UserPlus,
  Wallet,
  X,
} from "lucide-react"
import { useDashboardReport, useAtRiskCustomers, useDebtReport, useInventoryReport } from "../hooks/useReports"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { whatsappUrl } from "../utils/whatsapp"

interface QuickAction {
  id: string
  label: string
  to: string
  Icon: ComponentType<{ className?: string }>
  color: string
}

// All available quick actions
const ALL_QUICK_ACTIONS: QuickAction[] = [
  { id: "invoice-sale",     label: "فاتورة بيع",    to: "/invoices?type=SALE",       Icon: Receipt,      color: "from-emerald-500 to-emerald-600" },
  { id: "invoice-purchase", label: "فاتورة شراء",   to: "/invoices?type=PURCHASE",   Icon: ShoppingCart, color: "from-amber-500 to-amber-600" },
  { id: "receipt",          label: "سند قبض",        to: "/vouchers?action=RECEIPT",  Icon: ReceiptText,  color: "from-sky-500 to-sky-600" },
  { id: "payment",          label: "سند دفع",        to: "/vouchers?action=PAYMENT",  Icon: ReceiptText,  color: "from-orange-500 to-orange-600" },
  { id: "expense",          label: "مصاريف",         to: "/vouchers?action=EXPENSE",  Icon: Wallet,       color: "from-rose-500 to-rose-600" },
  { id: "account",          label: "كشف حساب",       to: "/account",                  Icon: Search,       color: "from-purple-500 to-purple-600" },
  { id: "new-invoice",      label: "فاتورة جديدة",  to: "/invoices/new",             Icon: FileText,     color: "from-teal-500 to-teal-600" },
  { id: "pos",              label: "POS سريع",       to: "/pos",                      Icon: ScanBarcode,  color: "from-indigo-500 to-indigo-600" },
  { id: "catalog",          label: "الكاتلوك",       to: "/catalog-management",       Icon: Globe,        color: "from-cyan-500 to-cyan-600" },
  { id: "products",         label: "المخزن",         to: "/inventory",                Icon: Boxes,        color: "from-slate-500 to-slate-600" },
  { id: "customers",        label: "الزبائن",        to: "/customers",                Icon: UserCheck,    color: "from-pink-500 to-pink-600" },
  { id: "new-customer",     label: "زبون جديد",      to: "/customers",                Icon: UserPlus,     color: "from-violet-500 to-violet-600" },
]

const DEFAULT_ENABLED = ["invoice-sale", "invoice-purchase", "receipt", "payment", "expense", "account"]
const STORAGE_KEY = "dashboard_quick_actions"

function useQuickActions() {
  const [enabled, setEnabled] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved) as string[]
    } catch {}
    return DEFAULT_ENABLED
  })

  function toggle(id: string) {
    setEnabled((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function reset() {
    setEnabled(DEFAULT_ENABLED)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_ENABLED))
  }

  const visible = ALL_QUICK_ACTIONS.filter((a) => enabled.includes(a.id))
  return { enabled, visible, toggle, reset }
}

function QuickActionsEditor({ enabled, onToggle, onReset, onClose }: {
  enabled: string[]
  onToggle: (id: string) => void
  onReset: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">تخصيص الاختصارات</h3>
            <p className="text-xs text-slate-500 mt-0.5">اختر الاختصارات اللي تريد تشوفها على الرئيسية</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {ALL_QUICK_ACTIONS.map((action) => {
            const on = enabled.includes(action.id)
            return (
              <label
                key={action.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${on ? "border-blue-200 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${action.color}`}>
                  <action.Icon className="h-4 w-4 text-white" />
                </div>
                <span className="flex-1 text-sm font-medium text-slate-800">{action.label}</span>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(action.id)}
                  className="h-4 w-4 accent-blue-600"
                />
              </label>
            )
          })}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            حفظ
          </button>
          <button
            onClick={onReset}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            إعادة تعيين
          </button>
        </div>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const dashboard = useDashboardReport()
  const inventory = useInventoryReport()
  const debts = useDebtReport({})
  const atRisk = useAtRiskCustomers(8)
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
  const [editActions, setEditActions] = useState(false)
  const { enabled, visible, toggle, reset } = useQuickActions()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">الرئيسية</h1>
        <p className="text-slate-500">اختصارات سريعة لأكثر العمليات استخداماً.</p>
      </div>

      {/* ── Pending Orders Alert ── */}
      <PendingOrdersBanner />

      {/* Quick actions */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-500">الاختصارات السريعة</p>
          <button
            type="button"
            onClick={() => setEditActions(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <Settings2 className="h-3.5 w-3.5" />
            تخصيص
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {visible.map(({ id, label, to, Icon, color }) => (
            <Link
              key={id}
              to={to}
              className={`group relative overflow-hidden rounded-xl bg-gradient-to-br ${color} p-5 text-white shadow-sm transition hover:shadow-lg hover:-translate-y-0.5`}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-7 w-7 opacity-90" />
                <span className="font-semibold">{label}</span>
              </div>
            </Link>
          ))}
          {visible.length === 0 && (
            <div className="col-span-full rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
              لا توجد اختصارات — اضغط "تخصيص" لإضافتها
            </div>
          )}
        </div>
      </div>

      {editActions && (
        <QuickActionsEditor
          enabled={enabled}
          onToggle={toggle}
          onReset={reset}
          onClose={() => setEditActions(false)}
        />
      )}

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

      {/* ── At-risk customers ── */}
      {(atRisk.data?.length ?? 0) > 0 ? (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <UserCheck className="h-5 w-5" />
              زبائن يحتاجون تواصل ({atRisk.data!.length})
            </CardTitle>
            <p className="text-xs text-slate-500">
              هؤلاء الزبائن تجاوزوا موعد شرائهم المعتاد ولم يُشترَ منهم منذ فترة.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <THead>
                <TR>
                  <TH>الزبون</TH>
                  <TH>متوسط الشراء</TH>
                  <TH>آخر شراء</TH>
                  <TH>تأخر</TH>
                  <TH>الرصيد</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {atRisk.data!.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.name}</TD>
                    <TD>كل {c.avgIntervalDays} يوم</TD>
                    <TD>{c.daysSinceLastPurchase} يوم</TD>
                    <TD>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        +{c.overdueDays} يوم
                      </span>
                    </TD>
                    <TD className={c.currentBalance > 0 ? "text-rose-600 font-semibold" : ""}>
                      {c.currentBalance.toLocaleString("en-US")}
                    </TD>
                    <TD>
                      <a
                        href={whatsappUrl(c.phone) ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                      >
                        <Phone className="h-3 w-3" />
                        تواصل
                      </a>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
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
