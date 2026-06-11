import { useState, type ComponentType } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { Link } from "react-router-dom"
import { motion, AnimatePresence } from "framer-motion"
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
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  ChevronDown,
  FileText,
  Globe,
  Lightbulb,
  Phone,
  Receipt,
  ReceiptText,
  Search,
  Settings2,
  ShoppingCart,
  ScanBarcode,
  TrendingUp,
  UserCheck,
  UserPlus,
  Wallet,
  X,
} from "lucide-react"
import { useDashboardReport, useAtRiskCustomers, useDailySummary, useDebtReport, useInventoryReport } from "../hooks/useReports"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { whatsappUrl } from "../utils/whatsapp"

interface QuickAction {
  id: string
  label: string
  to: string
  Icon: ComponentType<{ className?: string }>
  gradient: string
  shadow: string
  newTab?: boolean
}

const ALL_QUICK_ACTIONS: QuickAction[] = [
  { id: "invoice-sale",     label: "فاتورة بيع",   to: "/invoices?type=SALE",      Icon: Receipt,      gradient: "from-emerald-500 to-teal-600",   shadow: "rgba(16,185,129,0.35)" },
  { id: "invoice-purchase", label: "فاتورة شراء",  to: "/invoices?type=PURCHASE",  Icon: ShoppingCart, gradient: "from-amber-500 to-orange-500",   shadow: "rgba(245,158,11,0.35)" },
  { id: "receipt",          label: "سند قبض",       to: "/vouchers?action=RECEIPT", Icon: ReceiptText,  gradient: "from-sky-500 to-blue-600",       shadow: "rgba(14,165,233,0.35)" },
  { id: "payment",          label: "سند دفع",       to: "/vouchers?action=PAYMENT", Icon: ReceiptText,  gradient: "from-orange-500 to-red-500",     shadow: "rgba(249,115,22,0.35)" },
  { id: "expense",          label: "مصاريف",        to: "/vouchers?action=EXPENSE", Icon: Wallet,       gradient: "from-rose-500 to-pink-600",      shadow: "rgba(244,63,94,0.35)" },
  { id: "account",          label: "كشف حساب",      to: "/account",                 Icon: Search,       gradient: "from-violet-500 to-purple-600",  shadow: "rgba(139,92,246,0.35)" },
  { id: "new-invoice",      label: "فاتورة جديدة", to: "/invoices/new",            Icon: FileText,     gradient: "from-teal-500 to-cyan-600",      shadow: "rgba(20,184,166,0.35)", newTab: true },
  { id: "pos",              label: "POS سريع",      to: "/pos",                     Icon: ScanBarcode,  gradient: "from-indigo-500 to-blue-600",    shadow: "rgba(99,102,241,0.35)" },
  { id: "catalog",          label: "الكاتلوك",      to: "/catalog-management",      Icon: Globe,        gradient: "from-cyan-500 to-sky-600",       shadow: "rgba(6,182,212,0.35)" },
  { id: "products",         label: "المخزن",        to: "/inventory",               Icon: Boxes,        gradient: "from-slate-600 to-slate-700",    shadow: "rgba(71,85,105,0.35)" },
  { id: "customers",        label: "الزبائن",       to: "/customers",               Icon: UserCheck,    gradient: "from-pink-500 to-rose-600",      shadow: "rgba(236,72,153,0.35)" },
  { id: "new-customer",     label: "زبون جديد",     to: "/customers",               Icon: UserPlus,     gradient: "from-purple-500 to-violet-600",  shadow: "rgba(168,85,247,0.35)" },
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
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      dir="rtl"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-2xl p-5 shadow-2xl"
        style={{ backgroundColor: "var(--theme-cardBg)", border: "var(--z-border)" }}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold" style={{ color: "var(--theme-textPrimary)" }}>تخصيص الاختصارات</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--theme-textSecondary)" }}>اختر الاختصارات اللي تريد تشوفها</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" style={{ color: "var(--theme-textSecondary)" }} />
          </button>
        </div>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          {ALL_QUICK_ACTIONS.map((action) => {
            const on = enabled.includes(action.id)
            return (
              <label
                key={action.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition"
                style={{
                  borderColor: on ? "rgba(99,102,241,0.4)" : "var(--theme-cardBorder)",
                  background: on ? "var(--theme-accentSoft)" : "transparent",
                }}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${action.gradient}`}>
                  <action.Icon className="h-4 w-4 text-white" />
                </div>
                <span className="flex-1 text-sm font-medium" style={{ color: "var(--theme-textPrimary)" }}>
                  {action.label}
                </span>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(action.id)}
                  className="h-4 w-4 accent-indigo-600"
                />
              </label>
            )
          })}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white transition active:scale-95"
            style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 4px 12px rgba(99,102,241,0.35)" }}
          >
            حفظ
          </button>
          <button
            onClick={onReset}
            className="rounded-xl border px-4 py-2.5 text-sm transition hover:opacity-80"
            style={{ borderColor: "var(--theme-cardBorder)", color: "var(--theme-textSecondary)" }}
          >
            إعادة تعيين
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

const containerVariants = {
  hidden: {},
  show:   {},
}

const itemVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  show:   { opacity: 1, y: 0, scale: 1 },
}

export function DashboardPage() {
  usePageTitle("الرئيسية")
  const dashboard = useDashboardReport()
  const dailySummary = useDailySummary()
  const inventory = useInventoryReport()
  const debts = useDebtReport({})
  const atRisk = useAtRiskCustomers(8)
  const report = dashboard.data
  const daily = dailySummary.data
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

  const today = new Date().toISOString().slice(0, 10)

  const CHART_COLORS = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"]

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--theme-textPrimary)" }}>
          الرئيسية
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--theme-textSecondary)" }}>
          اختصارات سريعة لأكثر العمليات استخداماً
        </p>
      </div>

      <PendingOrdersBanner />

      {/* Smart tip + daily comparison */}
      {daily && (
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Today vs yesterday */}
          <div
            className="flex items-center gap-3 rounded-xl border p-3.5"
            style={{ background: "var(--theme-cardBg)", borderColor: "var(--theme-cardBorder)", boxShadow: "var(--z-shadow-sm)" }}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-950/40">
              <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs" style={{ color: "var(--theme-textSecondary)" }}>{daily.date}</div>
              <div className="text-base font-bold" style={{ color: "var(--theme-textPrimary)" }}>
                {daily.todaySales.toLocaleString("en-US")}
              </div>
            </div>
            {daily.salesChangePercent !== null && (
              <div className={`flex items-center gap-0.5 text-xs font-semibold ${daily.salesChangePercent >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                {daily.salesChangePercent >= 0
                  ? <ArrowUpRight className="h-3.5 w-3.5" />
                  : <ArrowDownRight className="h-3.5 w-3.5" />}
                {Math.abs(daily.salesChangePercent)}%
              </div>
            )}
          </div>

          {/* Collections today */}
          <div
            className="flex items-center gap-3 rounded-xl border p-3.5"
            style={{ background: "var(--theme-cardBg)", borderColor: "var(--theme-cardBorder)", boxShadow: "var(--z-shadow-sm)" }}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 dark:bg-sky-950/40">
              <Receipt className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--theme-textSecondary)" }}>تحصيلات اليوم</div>
              <div className="text-base font-bold" style={{ color: "var(--theme-textPrimary)" }}>
                {daily.collectionsToday.toLocaleString("en-US")}
              </div>
            </div>
          </div>

          {/* Smart tip */}
          {daily.smartTip ? (
            <div
              className="flex items-start gap-3 rounded-xl border p-3.5"
              style={{ background: "var(--theme-accentSoft)", borderColor: "rgba(99,102,241,0.25)", boxShadow: "var(--z-shadow-sm)" }}
            >
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
              <p className="text-xs leading-relaxed" style={{ color: "var(--theme-textPrimary)" }}>
                {daily.smartTip}
              </p>
            </div>
          ) : daily.mostOverdueCustomer ? (
            <div
              className="flex items-start gap-3 rounded-xl border p-3.5"
              style={{ background: "rgba(245,158,11,0.07)", borderColor: "rgba(245,158,11,0.3)", boxShadow: "var(--z-shadow-sm)" }}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs leading-relaxed" style={{ color: "var(--theme-textPrimary)" }}>
                {daily.mostOverdueCustomer.name} — لم يدفع منذ {daily.mostOverdueCustomer.daysLate} يوماً
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* Quick actions */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold" style={{ color: "var(--theme-textSecondary)" }}>
            الاختصارات السريعة
          </span>
          <motion.button
            type="button"
            onClick={() => setEditActions(true)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition"
            style={{ borderColor: "var(--theme-cardBorder)", color: "var(--theme-textSecondary)", background: "var(--theme-cardBg)" }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            تخصيص
          </motion.button>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          transition={{ staggerChildren: 0.06 }}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        >
          {visible.map(({ id, label, to, Icon, gradient, shadow, newTab }) => (
            <motion.div key={id} variants={itemVariants} transition={{ duration: 0.25 }}>
              {newTab ? (
                <button
                  type="button"
                  onClick={() => window.open(to, "_blank", "noopener")}
                  className={`group w-full relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 text-white transition-all duration-200 hover:-translate-y-1 text-right active:scale-97`}
                  style={{ boxShadow: `0 4px 20px ${shadow}` }}
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-px opacity-50"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)" }}
                  />
                  <Icon className="h-7 w-7 opacity-90 mb-2" />
                  <div className="text-[13px] font-semibold leading-tight">{label}</div>
                </button>
              ) : (
                <Link
                  to={to}
                  className={`group block relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 text-white transition-all duration-200 hover:-translate-y-1 active:scale-97`}
                  style={{ boxShadow: `0 4px 20px ${shadow}` }}
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-px opacity-50"
                    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)" }}
                  />
                  <Icon className="h-7 w-7 opacity-90 mb-2" />
                  <div className="text-[13px] font-semibold leading-tight">{label}</div>
                </Link>
              )}
            </motion.div>
          ))}
          {visible.length === 0 && (
            <div
              className="col-span-full rounded-2xl border-2 border-dashed p-8 text-center text-sm"
              style={{ borderColor: "var(--theme-cardBorder)", color: "var(--theme-textSecondary)" }}
            >
              لا توجد اختصارات — اضغط "تخصيص" لإضافتها
            </div>
          )}
        </motion.div>
      </div>

      <AnimatePresence>
        {editActions && (
          <QuickActionsEditor
            enabled={enabled}
            onToggle={toggle}
            onReset={reset}
            onClose={() => setEditActions(false)}
          />
        )}
      </AnimatePresence>

      {/* Toggle stats */}
      <motion.button
        type="button"
        onClick={() => setStatsOpen((v) => !v)}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.998 }}
        className="flex w-full items-center justify-between rounded-xl border p-3.5 text-sm font-medium transition"
        style={{
          background: "var(--theme-cardBg)",
          borderColor: "var(--theme-cardBorder)",
          color: "var(--theme-textPrimary)",
          boxShadow: "var(--z-shadow-sm)",
        }}
      >
        <span className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" style={{ color: "var(--theme-accent)" }} />
          {statsOpen ? "إخفاء الإحصائيات" : "عرض إحصائيات اليوم والمبيعات"}
        </span>
        <motion.div animate={{ rotate: statsOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4" style={{ color: "var(--theme-textSecondary)" }} />
        </motion.div>
      </motion.button>

      <AnimatePresence initial={false}>
        {statsOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="space-y-4 pt-2">
              {/* Metric cards */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <MetricCard
                  title="مبيعات اليوم"
                  value={report?.todaySales ?? 0}
                  icon={Wallet}
                  gradient="from-emerald-500 to-teal-600"
                  link={`/invoices?type=SALE&from=${today}&to=${today}`}
                  trend={daily?.salesChangePercent ?? null}
                  index={0}
                />
                <MetricCard
                  title="تحصيلات اليوم"
                  value={daily?.collectionsToday ?? 0}
                  icon={Receipt}
                  gradient="from-sky-500 to-blue-600"
                  index={1}
                />
                <MetricCard
                  title="فواتير اليوم"
                  value={report?.todayInvoices ?? 0}
                  icon={FileText}
                  gradient="from-blue-500 to-indigo-600"
                  link={`/invoices?from=${today}&to=${today}`}
                  index={2}
                />
                <MetricCard
                  title="إجمالي الديون"
                  value={report?.totalDebts ?? 0}
                  icon={AlertTriangle}
                  gradient="from-rose-500 to-red-600"
                  link="/customers"
                  index={3}
                />
                <MetricCard
                  title="منتجات ناقصة"
                  value={report?.lowStockProducts ?? 0}
                  icon={Boxes}
                  gradient="from-amber-500 to-orange-500"
                  link="/inventory/low-stock"
                  index={4}
                />
              </div>

              {/* Charts */}
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-[14px]">مبيعات آخر 7 أيام</CardTitle>
                  </CardHeader>
                  <CardContent className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={report?.lastSevenDaysSales ?? []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-cardBorder)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--theme-textSecondary)" />
                        <YAxis tick={{ fontSize: 11 }} stroke="var(--theme-textSecondary)" />
                        <Tooltip
                          contentStyle={{
                            background: "var(--theme-cardBg)",
                            border: "1px solid var(--theme-cardBorder)",
                            borderRadius: "10px",
                            boxShadow: "var(--z-shadow-md)",
                            fontSize: "12px",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="totalSales"
                          stroke="#6366F1"
                          strokeWidth={2.5}
                          dot={{ fill: "#6366F1", r: 3 }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-[14px]">توزيع المبيعات بالفئات</CardTitle>
                  </CardHeader>
                  <CardContent className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryData}
                          dataKey="value"
                          nameKey="category"
                          outerRadius={90}
                          innerRadius={40}
                          paddingAngle={3}
                          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {categoryData.map((_, index) => (
                            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "var(--theme-cardBg)",
                            border: "1px solid var(--theme-cardBorder)",
                            borderRadius: "10px",
                            fontSize: "12px",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Tables */}
              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-[14px]">أفضل 10 منتجات مبيعاً</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <THead><TR><TH>المنتج</TH><TH>الكمية</TH><TH>المبيعات</TH></TR></THead>
                      <TBody>
                        {(report?.topProductsThisMonth ?? []).slice(0, 10).map((p) => (
                          <TR key={p.productId}>
                            <TD>{p.productName}</TD>
                            <TD>{p.quantitySold}</TD>
                            <TD>{p.totalSales}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader><CardTitle className="text-[14px]">أعلى 5 زبائن ديوناً</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <THead><TR><TH>الزبون</TH><TH>المبلغ</TH><TH>آخر تعامل</TH></TR></THead>
                      <TBody>
                        {topCustomers.map((c) => (
                          <TR key={c.id}>
                            <TD>{c.name}</TD>
                            <TD>{c.currentBalance}</TD>
                            <TD>{c.lastTransactionAt?.slice(0, 10) ?? "-"}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* At-risk customers */}
      {(atRisk.data?.length ?? 0) > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card style={{ borderColor: "rgba(245,158,11,0.4)" }}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-[14px]" style={{ color: "#D97706" }}>
                <UserCheck className="h-5 w-5" />
                زبائن يحتاجون تواصل ({atRisk.data!.length})
              </CardTitle>
              <p className="text-xs mt-0.5" style={{ color: "var(--theme-textSecondary)" }}>
                هؤلاء الزبائن تجاوزوا موعد شرائهم المعتاد.
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
        </motion.div>
      )}
    </div>
  )
}

function MetricCard({
  title,
  value,
  icon: Icon,
  gradient,
  link,
  trend = null,
  index = 0,
}: {
  title: string
  value: number
  icon: ComponentType<{ className?: string }>
  gradient: string
  link?: string
  trend?: number | null
  index?: number
}) {
  const content = (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 text-white`}
      style={{ minHeight: 96 }}
    >
      {/* Shimmer top line */}
      <div
        className="absolute top-0 left-0 right-0 h-px opacity-40"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)" }}
      />
      {/* Glow blob */}
      <div className="absolute -top-4 -left-4 h-20 w-20 rounded-full bg-white/10 blur-2xl" />

      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-[12px] font-medium text-white/75 mb-1">{title}</div>
          <div className="text-2xl font-bold tracking-tight">{value.toLocaleString("en-US")}</div>
          {trend !== null && (
            <div className="mt-1 flex items-center gap-0.5 text-[11px] text-white/80">
              {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(trend)}% مقارنة بالأمس
            </div>
          )}
          {!trend && link && <div className="mt-1 text-[11px] text-white/60">اضغط للعرض</div>}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  )

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3 }}
    >
      {link ? <Link to={link}>{content}</Link> : content}
    </motion.div>
  )
}
