import { useState, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Search,
  ShieldOff,
  Tag,
  TagOff,
  Unlock,
  X,
} from "lucide-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import "dayjs/locale/ar"
import {
  getCatalogCustomers,
  grantCatalogAccess,
  patchCatalogAccess,
  revokeCatalogAccess,
} from "../api/endpoints"
import type { CatalogCustomer } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { cn } from "../utils/cn"
import { useAuthStore } from "../store/authStore"

dayjs.extend(relativeTime)
dayjs.locale("ar")

const CATALOG_BASE = window.location.origin + "/catalog?access="

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

function StatusBadge({ customer }: { customer: CatalogCustomer }) {
  if (!customer.hasAccess)
    return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500"><Lock className="h-3 w-3" />بدون صلاحية</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700"><Unlock className="h-3 w-3" />نشط</span>
}

function ToggleChip({
  on,
  labelOn,
  labelOff,
  iconOn,
  iconOff,
  onClick,
  disabled,
}: {
  on: boolean
  labelOn: string
  labelOff: string
  iconOn: React.ReactNode
  iconOff: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all",
        on
          ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {on ? iconOn : iconOff}
      {on ? labelOn : labelOff}
    </button>
  )
}

function GrantDialog({
  customer,
  onClose,
}: {
  customer: CatalogCustomer
  onClose: () => void
}) {
  const [allowPrices, setAllowPrices] = useState(false)
  const [showStock, setShowStock] = useState(true)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => grantCatalogAccess(customer.id, { allowPrices, showStock }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog-customers"] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold">منح صلاحية الكاتلوك</h3>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-semibold">{customer.name}</p>
          <p className="text-slate-500">{customer.phone}</p>
        </div>

        <div className="space-y-3 text-sm">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3 transition hover:bg-slate-50">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-blue-600" />
              <span>إظهار الأسعار للزبون</span>
            </div>
            <input
              type="checkbox"
              checked={allowPrices}
              onChange={(e) => setAllowPrices(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3 transition hover:bg-slate-50">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-emerald-600" />
              <span>إظهار الكمية المتوفرة</span>
            </div>
            <input
              type="checkbox"
              checked={showStock}
              onChange={(e) => setShowStock(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
          </label>
        </div>

        {mutation.isError && (
          <p className="mt-3 rounded-md bg-rose-50 p-2 text-xs text-rose-600">تعذر منح الصلاحية. حاول مرة أخرى.</p>
        )}

        <div className="mt-5 flex gap-2">
          <Button className="flex-1" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "جاري المنح..." : "منح الصلاحية"}
          </Button>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
        </div>
      </div>
    </div>
  )
}

function CustomerRow({ customer }: { customer: CatalogCustomer }) {
  const [grantOpen, setGrantOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const qc = useQueryClient()

  const patchMut = useMutation({
    mutationFn: (patch: { allowPrices?: boolean; showStock?: boolean }) =>
      patchCatalogAccess(customer.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-customers"] }),
  })

  const revokeMut = useMutation({
    mutationFn: () => revokeCatalogAccess(customer.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-customers"] }),
  })

  function handleCopy() {
    if (!customer.token) return
    copyText(CATALOG_BASE + customer.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isLoading = patchMut.isPending || revokeMut.isPending

  return (
    <>
      {grantOpen && <GrantDialog customer={customer} onClose={() => setGrantOpen(false)} />}

      <tr className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
        {/* الزبون */}
        <td className="px-4 py-3">
          <p className="font-semibold text-slate-800">{customer.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{customer.phone}</p>
        </td>

        {/* الحالة */}
        <td className="px-4 py-3">
          <StatusBadge customer={customer} />
        </td>

        {/* الأسعار toggle */}
        <td className="px-4 py-3">
          <ToggleChip
            on={customer.hasAccess && customer.allowPrices}
            labelOn="ظاهرة"
            labelOff="مخفية"
            iconOn={<Tag className="h-3 w-3" />}
            iconOff={<TagOff className="h-3 w-3" />}
            disabled={!customer.hasAccess || isLoading}
            onClick={() => patchMut.mutate({ allowPrices: !customer.allowPrices })}
          />
        </td>

        {/* الكمية toggle */}
        <td className="px-4 py-3">
          <ToggleChip
            on={customer.hasAccess && customer.showStock}
            labelOn="ظاهرة"
            labelOff="مخفية"
            iconOn={<Eye className="h-3 w-3" />}
            iconOff={<EyeOff className="h-3 w-3" />}
            disabled={!customer.hasAccess || isLoading}
            onClick={() => patchMut.mutate({ showStock: !customer.showStock })}
          />
        </td>

        {/* آخر زيارة */}
        <td className="px-4 py-3 text-xs text-slate-500">
          {customer.lastViewedAt
            ? dayjs(customer.lastViewedAt).fromNow()
            : customer.hasAccess
            ? "لم يُفتح بعد"
            : "—"}
        </td>

        {/* إجراءات */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {customer.hasAccess ? (
              <>
                <button
                  title="نسخ رابط الكاتلوك"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs hover:bg-slate-50"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "تم النسخ" : "نسخ الرابط"}
                </button>
                <button
                  title="سحب الصلاحية"
                  disabled={revokeMut.isPending}
                  onClick={() => revokeMut.mutate()}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  سحب
                </button>
              </>
            ) : (
              <button
                onClick={() => setGrantOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                <Globe className="h-3.5 w-3.5" />
                منح صلاحية
              </button>
            )}
          </div>
        </td>
      </tr>
    </>
  )
}

export function CatalogManagementPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin())
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all")

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ["catalog-customers"],
    queryFn: getCatalogCustomers,
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter((c) => {
      const matchSearch = !q || c.name.toLowerCase().includes(q) || c.phone.includes(q)
      const matchFilter =
        filter === "all" ||
        (filter === "active" && c.hasAccess) ||
        (filter === "inactive" && !c.hasAccess)
      return matchSearch && matchFilter
    })
  }, [customers, search, filter])

  const stats = useMemo(() => ({
    total: customers.length,
    active: customers.filter((c) => c.hasAccess).length,
    inactive: customers.filter((c) => !c.hasAccess).length,
  }), [customers])

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">إدارة كاتلوك المنتجات</h1>
        <p className="mt-1 text-sm text-slate-500">تحكم بصلاحيات الزبائن للوصول إلى الكاتلوك العام وإظهار الأسعار والكميات</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="إجمالي الزبائن"
          value={stats.total}
          color="slate"
        />
        <StatCard
          label="لديهم صلاحية"
          value={stats.active}
          color="emerald"
        />
        <StatCard
          label="بدون صلاحية"
          value={stats.inactive}
          color="rose"
        />
      </div>

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-3 px-4">
          <div className="flex items-start gap-3 text-sm text-blue-800">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <div>
              <p className="font-semibold mb-1">كيف يعمل الكاتلوك؟</p>
              <ul className="space-y-0.5 text-blue-700 text-xs list-disc list-inside">
                <li>الزبون يفتح رابط <strong>{window.location.origin}/catalog</strong> ويكتب اسمه ورقمه ← يرسل طلب موافقة يظهر في صفحة الموافقات</li>
                <li>أو من هنا مباشرة: اختار الزبون واضغط "منح صلاحية" وحدد الإعدادات ← انسخ الرابط وأرسله للزبون</li>
                <li>الزبون يفتح الرابط ← يشوف المنتجات المتوفرة ويرسل طلب شراء يظهر في الموافقات</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search + Filter */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-5 w-5 text-blue-600" />
            صلاحيات الزبائن
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pr-9"
                placeholder="ابحث باسم الزبون أو الهاتف"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-1.5">
              {(["all", "active", "inactive"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {f === "all" ? `الكل (${stats.total})` : f === "active" ? `نشط (${stats.active})` : `بدون صلاحية (${stats.inactive})`}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-right">الزبون</th>
                  <th className="px-4 py-3 text-right">الحالة</th>
                  <th className="px-4 py-3 text-right">الأسعار</th>
                  <th className="px-4 py-3 text-right">الكمية</th>
                  <th className="px-4 py-3 text-right">آخر زيارة</th>
                  <th className="px-4 py-3 text-right">إجراءات</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">جاري التحميل...</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-400">لا توجد نتائج</td>
                  </tr>
                ) : (
                  filtered.map((customer) => (
                    <CustomerRow key={customer.id} customer={customer} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && (
            <p className="text-right text-xs text-slate-400">
              {filtered.length} زبون{filtered.length !== customers.length ? ` من ${customers.length}` : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: "slate" | "emerald" | "rose" }) {
  const colors = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  }
  return (
    <div className={cn("rounded-xl border p-4", colors[color])}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs font-medium opacity-80">{label}</p>
    </div>
  )
}
