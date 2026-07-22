import { Fragment, useEffect, useState, useMemo, useRef } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BarChart3,
  BookOpen,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Globe,
  Image,
  Lock,
  MessageCircle,
  Package,
  Palette,
  Phone,
  Plus,
  Search,
  Send,
  Shuffle,
  ShieldOff,
  Tag,
  Ticket,
  Users,
  Trash2,
  Unlock,
  UserPlus,
  X,
} from "lucide-react"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import "dayjs/locale/ar"
import {
  broadcastCatalogLink,
  deleteCustomer,
  getCatalogCustomers,
  getCatalogVisitors,
  getVisitorProductViews,
  convertCatalogVisitor,
  broadcastToCatalogVisitors,
  getCatalogProductStats,
  type CatalogProductStat,
  getCatalogDesign,
  updateCatalogDesign,
  listAdminPromoCodes,
  createAdminPromoCode,
  deleteAdminPromoCode,
  toggleAdminPromoCode,
  getCustomerTags,
  getCustomersPaged,
  getSettings,
  updateSettings,
  grantCatalogAccess,
  patchCatalogAccess,
  revokeCatalogAccess,
  sendCatalogLinkToCustomer,
  type CatalogDesign,
  type PromoCode,
} from "../api/endpoints"
import type { CatalogCustomer, CatalogStockFilter } from "../types/api"
import { useAuthStore } from "../store/authStore"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { useFeatureEnabled } from "../hooks/useTenantConfig"

dayjs.extend(relativeTime)
dayjs.locale("ar")

const CATALOG_BASE = window.location.origin + "/catalog?access="

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
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
  const [stockFilter, setStockFilter] = useState<CatalogStockFilter>("FULL_CARTON_ONLY")
  const qc = useQueryClient()
  const showHidePriceEnabled = useFeatureEnabled("catalogShowHidePrice")
  const showHideStockEnabled = useFeatureEnabled("catalogShowHideStock")
  const fullCartonFilterEnabled = useFeatureEnabled("catalogFullCartonFilter")

  const mutation = useMutation({
    mutationFn: () => grantCatalogAccess(customer.id, { allowPrices, showStock, stockFilter }),
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
              disabled={!showHidePriceEnabled}
              onChange={(e) => setAllowPrices(e.target.checked)}
              className="h-4 w-4 accent-blue-600"
            />
          </label>
          {!showHidePriceEnabled && (
            <p className="text-[11px] text-amber-600">ميزة التحكم بالسعر غير مفعّلة في خطتك.</p>
          )}

          <label className="flex cursor-pointer items-center justify-between rounded-lg border p-3 transition hover:bg-slate-50">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-emerald-600" />
              <span>إظهار الكمية المتوفرة</span>
            </div>
            <input
              type="checkbox"
              checked={showStock}
              disabled={!showHideStockEnabled}
              onChange={(e) => setShowStock(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
            />
          </label>
          {!showHideStockEnabled && (
            <p className="text-[11px] text-amber-600">ميزة التحكم بالمخزون غير مفعّلة في خطتك.</p>
          )}

          <div className="rounded-lg border p-3">
            <p className="mb-2 flex items-center gap-2 font-medium">
              <BookOpen className="h-4 w-4 text-violet-600" />
              المواد المعروضة
            </p>
            <select
              value={stockFilter}
              disabled={!fullCartonFilterEnabled}
              onChange={(e) => setStockFilter(e.target.value as CatalogStockFilter)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="FULL_CARTON_ONLY">كارتون كامل فقط (الافتراضي)</option>
              <option value="ALL_PRODUCTS">كل المواد المتوفرة حتى لو أقل من كارتون</option>
            </select>
            <p className="mt-1.5 text-[11px] text-slate-400">هذا الخيار يتحكم بعرض المواد فقط، والبيع متاح بكل الوحدات (قطعة/علبة/درزن/كارتون).</p>
            {!fullCartonFilterEnabled && (
              <p className="mt-1 text-[11px] text-amber-600">ميزة فلتر الكرتون الكامل غير مفعّلة في خطتك.</p>
            )}
          </div>
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

function CustomerRow({ customer, isAdmin }: { customer: CatalogCustomer; isAdmin: boolean }) {
  const [grantOpen, setGrantOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [promo, setPromo] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const qc = useQueryClient()
  const showHidePriceEnabled = useFeatureEnabled("catalogShowHidePrice")
  const showHideStockEnabled = useFeatureEnabled("catalogShowHideStock")
  const fullCartonFilterEnabled = useFeatureEnabled("catalogFullCartonFilter")

  const deleteMut = useMutation({
    mutationFn: () => deleteCustomer(customer.id),
    onSuccess: () => {
      setConfirmDelete(false)
      void qc.invalidateQueries({ queryKey: ["catalog-customers"] })
      void qc.invalidateQueries({ queryKey: ["customers"] })
      toast({ title: `تم حذف الزبون ${customer.name}` })
    },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر الحذف"), variant: "destructive" }),
  })

  const sendLinkMut = useMutation({
    mutationFn: () => sendCatalogLinkToCustomer(customer.id, promo.trim() || undefined),
    onSuccess: (res) => { toast({ title: res.message ?? "تم إرسال رابط الكتلوج" }); setPromo("") },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر الإرسال"), variant: "destructive" }),
  })

  const patchMut = useMutation({
    mutationFn: (patch: { allowPrices?: boolean; showStock?: boolean; stockFilter?: CatalogStockFilter }) =>
      patchCatalogAccess(customer.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-customers"] }),
  })

  const revokeMut = useMutation({
    mutationFn: () => revokeCatalogAccess(customer.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["catalog-customers"] }),
  })

  async function handleCopy() {
    if (!customer.token) return
    const link = CATALOG_BASE + customer.token
    const ok = await copyText(link)
    if (ok) {
      toast({ title: "تم نسخ رابط الكتالوج" })
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      toast({ title: "تعذر النسخ، انسخ الرابط يدوياً", description: link, variant: "destructive" })
    }
  }

  const isLoading = patchMut.isPending || revokeMut.isPending

  return (
    <>
      {grantOpen && <GrantDialog customer={customer} onClose={() => setGrantOpen(false)} />}
      <ConfirmDialog
        open={confirmDelete}
        title={`حذف ${customer.name} نهائياً؟`}
        description="سيُحذف الزبون وكل بياناته بشكل دائم. لا يمكن التراجع."
        confirmLabel="حذف نهائي"
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />

      <tr className="border-b last:border-0 hover:bg-slate-50/60 transition-colors">
        {/* الزبون */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div>
              <p className="font-semibold text-slate-800">{customer.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{customer.phone}</p>
            </div>
            {isAdmin && (
              <button
                type="button"
                title="حذف الزبون"
                onClick={() => setConfirmDelete(true)}
                className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 text-rose-500 hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
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
            iconOff={<Tag className="h-3 w-3 opacity-40" />}
            disabled={!customer.hasAccess || isLoading || !showHidePriceEnabled}
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
            disabled={!customer.hasAccess || isLoading || !showHideStockEnabled}
            onClick={() => patchMut.mutate({ showStock: !customer.showStock })}
          />
        </td>

        {/* فلتر العرض: كل المواد / كارتون كامل فقط */}
        <td className="px-4 py-3">
          <ToggleChip
            on={customer.hasAccess && customer.stockFilter === "ALL_PRODUCTS"}
            labelOn="كل المواد"
            labelOff="كارتون كامل"
            iconOn={<BookOpen className="h-3 w-3" />}
            iconOff={<BookOpen className="h-3 w-3 opacity-40" />}
            disabled={!customer.hasAccess || isLoading || !fullCartonFilterEnabled}
            onClick={() =>
              patchMut.mutate({
                stockFilter: customer.stockFilter === "ALL_PRODUCTS" ? "FULL_CARTON_ONLY" : "ALL_PRODUCTS",
              })
            }
          />
        </td>

        {/* آخر زيارة */}
        <td className="px-4 py-3 text-xs text-slate-500">
          {customer.lastViewedAt ? (
            <div className="flex flex-col gap-0.5">
              <span>{dayjs(customer.lastViewedAt).fromNow()}</span>
              {(customer.viewCount ?? 0) > 0 && (
                <span className="text-[11px] text-slate-400">{customer.viewCount} فتحة</span>
              )}
            </div>
          ) : customer.hasAccess ? (
            "لم يُفتح بعد"
          ) : (
            "—"
          )}
        </td>

        {/* إرسال رابط الكتلوج بالواتساب + بروموكود */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Input
              value={promo}
              onChange={(e) => setPromo(e.target.value)}
              placeholder="بروموكود (اختياري)"
              className="h-8 w-28 text-xs"
            />
            <button
              type="button"
              title="إرسال رابط الكتلوج بالواتساب"
              disabled={sendLinkMut.isPending}
              onClick={() => sendLinkMut.mutate()}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              {sendLinkMut.isPending ? "..." : "إرسال"}
            </button>
          </div>
          {customer.catalogLinkSentAt && (
            <p className={cn("mt-1 text-[10px]", isSentNotOpened(customer) ? "text-amber-600" : "text-emerald-600")}>
              {isSentNotOpened(customer) ? "أُرسل · لم يُفتح بعد" : "أُرسل · وفتحه ✓"}
            </p>
          )}
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

// Bulk-send the catalog link to everyone carrying a chosen tag (fire-and-forget).
function BulkCatalogSend() {
  const tagsQuery = useQuery({ queryKey: ["customer-tags"], queryFn: getCustomerTags })
  const tags = tagsQuery.data ?? []
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [promo, setPromo] = useState("")
  const qc = useQueryClient()

  const recipientsQuery = useQuery({
    queryKey: ["customers-by-tags-count", selectedTags],
    queryFn: () => getCustomersPaged({ tags: selectedTags, limit: 1 }),
    enabled: selectedTags.length > 0,
  })
  const recipientCount = recipientsQuery.data?.pagination?.total ?? 0

  const sendMut = useMutation({
    mutationFn: () => broadcastCatalogLink({ tags: selectedTags, promoCode: promo.trim() || undefined }),
    onSuccess: (res) => {
      toast({ title: res.message ?? `جارٍ الإرسال إلى ${recipientCount} زبون` })
      setSelectedTags([]); setPromo("")
      void qc.invalidateQueries({ queryKey: ["catalog-customers"] })
    },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر الإرسال"), variant: "destructive" }),
  })

  function toggleTag(tag: string) {
    setSelectedTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]))
  }

  return (
    <Card className="border-emerald-200 bg-emerald-50/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-5 w-5 text-emerald-600" /> إرسال جماعي لرابط الكتلوج (حسب التاك)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {tags.length === 0 ? (
          <p className="text-sm text-slate-500">لا يوجد تاكات بعد. أضف تاكات للزبائن من صفحة الزبائن أولاً.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition",
                  selectedTags.includes(tag) ? "bg-emerald-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
        {selectedTags.length > 0 && (
          <p className="text-sm text-emerald-700">
            {recipientsQuery.isLoading ? "جاري الحساب..." : <>سيُرسل رابط الكتلوج إلى <b>{recipientCount}</b> زبون.</>}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={promo}
            onChange={(e) => setPromo(e.target.value)}
            placeholder="بروموكود للجميع (اختياري)"
            className="sm:max-w-xs"
          />
          <Button
            disabled={selectedTags.length === 0 || recipientCount === 0 || sendMut.isPending}
            onClick={() => sendMut.mutate()}
          >
            <MessageCircle className="h-4 w-4" /> {sendMut.isPending ? "جارٍ الإرسال..." : "إرسال للجميع"}
          </Button>
        </div>
        <p className="text-[11px] text-slate-400">يُرسل تلقائياً بالخلفية مع تمهّل بسيط بين كل رسالة. على WhatsApp Cloud API قد لا تصل خارج نافذة ٢٤ ساعة.</p>
      </CardContent>
    </Card>
  )
}

// "Sent but not opened": the catalog link was sent and the customer hasn't
// opened the catalog since (no view, or last view predates the send).
function isSentNotOpened(c: CatalogCustomer) {
  if (!c.catalogLinkSentAt) return false
  if (!c.lastViewedAt) return true
  return new Date(c.lastViewedAt).getTime() < new Date(c.catalogLinkSentAt).getTime()
}

/* ══════════════════════════════════════════════════════════════════════
   CATALOG DESIGN TAB
══════════════════════════════════════════════════════════════════════ */
const THEME_LABELS = { clean: "☀️ نظيف", warm: "🏪 دافئ", dark: "🌙 فاخر", vibrant: "🎨 حيوي" }

/* ── Banner Product Picker ── */
function BannerProductPicker({ onPick }: { onPick: (url: string, name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const { data, isLoading } = useQuery({
    queryKey: ["banner-picker-products", search],
    queryFn: () => import("../api/endpoints").then(m => m.getProducts({ search: search || undefined, limit: 30 })),
    staleTime: 60_000,
  })
  const products = useMemo(() => (data ?? []).filter((p) => p.thumbnailUrl || p.imageUrl), [data])

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-500 hover:border-violet-400 hover:text-violet-600 transition-colors">
        <Image className="h-3.5 w-3.5" /> استعراض صور المنتجات
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 p-2">
        <Search className="h-4 w-4 text-slate-400 shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث عن منتج..." className="flex-1 text-sm outline-none" />
        <button onClick={() => setOpen(false)} className="shrink-0 rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-400" /></button>
      </div>
      {isLoading && <p className="py-4 text-center text-xs text-slate-400">جاري التحميل...</p>}
      {!isLoading && products.length === 0 && <p className="py-4 text-center text-xs text-slate-400">لا توجد منتجات بصور</p>}
      <div className="grid grid-cols-4 gap-1.5 p-2 max-h-48 overflow-y-auto">
        {products.map((p) => (
          <button key={p.id} type="button"
            onClick={async () => {
              // Grid shows the thumbnail, but the banner needs the full image.
              let full = p.imageUrl
              if (!full) {
                try { full = (await import("../api/endpoints").then(m => m.getProduct(p.id)))?.imageUrl ?? p.thumbnailUrl ?? "" } catch { full = p.thumbnailUrl ?? "" }
              }
              onPick(full ?? "", p.name); setOpen(false)
            }}
            className="group overflow-hidden rounded-lg border border-slate-200 hover:border-violet-400 transition-colors"
            title={p.name}>
            <div className="aspect-square overflow-hidden">
              <img src={p.thumbnailUrl ?? p.imageUrl ?? ""} alt={p.name} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200" />
            </div>
            <p className="truncate px-1 py-0.5 text-[9px] text-slate-500">{p.name}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function CatalogDesignTab() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ["catalog-design"], queryFn: getCatalogDesign })
  const [form, setForm] = useState<Partial<CatalogDesign>>({})
  const [newBannerUrl, setNewBannerUrl] = useState("")
  const [newBannerTitle, setNewBannerTitle] = useState("")

  const current: CatalogDesign = {
    primaryColor: null, bgColor: null, defaultTheme: "clean", logoUrl: null,
    welcomeMessage: null, bannerEnabled: true, bannerImages: [],
    ...data,
    ...form,
  }

  const saveMut = useMutation({
    mutationFn: () => updateCatalogDesign(current),
    onSuccess: () => { toast({ title: "تم حفظ تصميم الكتلوك" }); qc.invalidateQueries({ queryKey: ["catalog-design"] }); setForm({}) },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  function patch(key: keyof CatalogDesign, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function addBanner() {
    if (!newBannerUrl.trim()) return
    const images = [...(current.bannerImages ?? []), { url: newBannerUrl.trim(), title: newBannerTitle.trim(), order: current.bannerImages.length }]
    patch("bannerImages", images)
    setNewBannerUrl(""); setNewBannerTitle("")
  }

  function removeBanner(idx: number) {
    patch("bannerImages", current.bannerImages.filter((_, i) => i !== idx).map((img, i) => ({ ...img, order: i })))
  }

  if (isLoading) return <div className="py-10 text-center text-sm text-slate-400">جاري التحميل...</div>

  return (
    <div className="space-y-6">
      {/* Colors */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Palette className="h-5 w-5 text-violet-600" />الألوان والثيم</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(Object.keys(THEME_LABELS) as Array<keyof typeof THEME_LABELS>).map((t) => (
              <button
                key={t}
                onClick={() => patch("defaultTheme", t)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-2xl border-2 p-3 text-sm font-semibold transition",
                  current.defaultTheme === t ? "border-violet-500 bg-violet-50 text-violet-700" : "border-slate-200 hover:border-violet-300",
                )}
              >
                <span className="text-2xl">{THEME_LABELS[t].split(" ")[0]}</span>
                <span>{THEME_LABELS[t].split(" ").slice(1).join(" ")}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-600">لون رئيسي مخصص (اختياري — يتجاوز ألوان الثيم)</span>
              <div className="flex items-center gap-2">
                <input type="color" value={current.primaryColor ?? "#059669"}
                  onChange={(e) => patch("primaryColor", e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-lg border p-1" />
                <Input value={current.primaryColor ?? ""} onChange={(e) => patch("primaryColor", e.target.value || null)}
                  placeholder="#059669" className="flex-1 font-mono text-sm" dir="ltr" />
                {current.primaryColor && <button onClick={() => patch("primaryColor", null)} className="text-xs text-slate-400 hover:text-red-500">مسح</button>}
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-600">لون الخلفية المخصص (اختياري)</span>
              <div className="flex items-center gap-2">
                <input type="color" value={current.bgColor ?? "#f8fafc"}
                  onChange={(e) => patch("bgColor", e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-lg border p-1" />
                <Input value={current.bgColor ?? ""} onChange={(e) => patch("bgColor", e.target.value || null)}
                  placeholder="#f8fafc" className="flex-1 font-mono text-sm" dir="ltr" />
                {current.bgColor && <button onClick={() => patch("bgColor", null)} className="text-xs text-slate-400 hover:text-red-500">مسح</button>}
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Logo + Welcome */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Image className="h-5 w-5 text-blue-600" />الشعار والرسالة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-600">رابط الشعار (URL)</span>
            <div className="flex items-center gap-2">
              <Input value={current.logoUrl ?? ""} onChange={(e) => patch("logoUrl", e.target.value || null)}
                placeholder="https://..." dir="ltr" className="flex-1 text-sm" />
              {current.logoUrl && <img src={current.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain border" onError={(e) => e.currentTarget.classList.add("hidden")} />}
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-600">رسالة الترحيب (تظهر للزبون في الكتلوك)</span>
            <Input value={current.welcomeMessage ?? ""} onChange={(e) => patch("welcomeMessage", e.target.value || null)}
              placeholder="مرحباً بك في متجرنا — أسعار الجملة المميزة" className="text-sm" />
          </label>
        </CardContent>
      </Card>

      {/* Banner images */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Image className="h-5 w-5 text-emerald-600" />صور البانر المتحرك</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={current.bannerEnabled} onChange={(e) => patch("bannerEnabled", e.target.checked)} className="h-4 w-4 accent-emerald-600" />
            <span className="text-sm font-medium text-slate-700">إظهار البانر المتحرك</span>
          </label>

          {/* Existing images */}
          {current.bannerImages.length > 0 && (
            <div className="space-y-2">
              {current.bannerImages.map((img, idx) => (
                <div key={idx} className="flex items-center gap-3 rounded-xl border bg-slate-50 p-2.5">
                  <img src={img.url} alt="" className="h-12 w-16 rounded-lg object-cover border" onError={(e) => e.currentTarget.src = ""} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{img.title || "(بدون عنوان)"}</p>
                    <p className="truncate text-xs text-slate-400" dir="ltr">{img.url}</p>
                  </div>
                  <button onClick={() => removeBanner(idx)} className="shrink-0 rounded-lg p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new banner */}
          <div className="rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/40 p-3 space-y-3">
            <p className="text-xs font-semibold text-violet-700 flex items-center gap-1.5">
              <Image className="h-3.5 w-3.5" /> إضافة صورة للبانر
            </p>

            {/* URL input with preview */}
            <div className="flex gap-2 items-start">
              {newBannerUrl && (
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg border bg-slate-100">
                  <img src={newBannerUrl} alt="" className="h-full w-full object-cover"
                    onError={(e) => { e.currentTarget.style.opacity = "0.3" }} />
                </div>
              )}
              <div className="flex-1 space-y-1.5">
                <Input
                  value={newBannerUrl}
                  onChange={(e) => setNewBannerUrl(e.target.value)}
                  placeholder="https://... الصق رابط الصورة هنا"
                  dir="ltr"
                  className="text-sm font-mono text-xs"
                />
                <p className="text-[10px] text-slate-400">
                  يمكنك نسخ رابط الصورة من منتج موجود أو أي رابط صورة على الانترنت
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Input value={newBannerTitle} onChange={(e) => setNewBannerTitle(e.target.value)} placeholder="عنوان يظهر فوق الصورة (اختياري)" className="flex-1 text-sm" />
              <Button onClick={addBanner} disabled={!newBannerUrl.trim()} className="shrink-0">
                <Plus className="h-4 w-4 ml-1" /> إضافة
              </Button>
            </div>
          </div>

          {/* Quick pick from products */}
          <BannerProductPicker onPick={(url, name) => { setNewBannerUrl(url); setNewBannerTitle(name) }} />
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="px-8">
          {saveMut.isPending ? "جاري الحفظ..." : "حفظ التغييرات"}
        </Button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   PROMO CODES TAB
══════════════════════════════════════════════════════════════════════ */
const PROMO_TYPE_LABELS: Record<PromoCode["type"], string> = {
  PERCENT: "خصم %",
  AMOUNT: "خصم مبلغ",
  FREE_DELIVERY: "توصيل مجاني",
}

function PromoCodesTab() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [code, setCode] = useState("")
  const [type, setType] = useState<PromoCode["type"]>("PERCENT")
  const [value, setValue] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [usageLimit, setUsageLimit] = useState("")
  const [description, setDescription] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: promos = [], isLoading } = useQuery({ queryKey: ["admin-promo-codes"], queryFn: listAdminPromoCodes })

  const { data: catalogData } = useQuery({ queryKey: ["catalog-customers", "", 0], queryFn: () => getCatalogCustomers({ limit: 200 }) })
  const customers = catalogData?.rows ?? []

  const createMut = useMutation({
    mutationFn: () => createAdminPromoCode({
      code, type,
      value: value ? Number(value) : undefined,
      customerId: customerId || undefined,
      expiresAt: expiresAt || undefined,
      usageLimit: usageLimit ? Number(usageLimit) : undefined,
      description: description || undefined,
    }),
    onSuccess: () => {
      toast({ title: "تم إنشاء كود الخصم" })
      qc.invalidateQueries({ queryKey: ["admin-promo-codes"] })
      setShowForm(false)
      setCode(""); setType("PERCENT"); setValue(""); setCustomerId(""); setExpiresAt(""); setUsageLimit(""); setDescription("")
    },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر الإنشاء"), variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdminPromoCode(id),
    onSuccess: () => { toast({ title: "تم الحذف" }); qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }); setDeleteId(null) },
    onError: () => toast({ title: "تعذر الحذف", variant: "destructive" }),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => toggleAdminPromoCode(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-promo-codes"] }),
  })

  const customersWithAccess = customers.filter((c) => c.hasAccess)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-700">أكواد الخصم</p>
          <p className="text-xs text-slate-500">أنشئ أكواد خصم للزبائن أو لكل الطلبات</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4" /> إنشاء كود
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="border-violet-200 bg-violet-50/30">
          <CardContent className="space-y-3 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">الكود *</span>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="SALE2024" dir="ltr" className="font-mono tracking-wider uppercase" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">نوع الخصم *</span>
                <select value={type} onChange={(e) => setType(e.target.value as PromoCode["type"])}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  {(Object.keys(PROMO_TYPE_LABELS) as PromoCode["type"][]).map((t) => (
                    <option key={t} value={t}>{PROMO_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </label>
            </div>

            {type !== "FREE_DELIVERY" && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">{type === "PERCENT" ? "نسبة الخصم (%)" : "مبلغ الخصم (د.ع)"}</span>
                <Input type="number" value={value} onChange={(e) => setValue(e.target.value)}
                  placeholder={type === "PERCENT" ? "10" : "5000"} dir="ltr" min="0" />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">خاص بزبون (اختياري)</span>
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <option value="">كل الزبائن</option>
                  {customersWithAccess.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">حد الاستخدام (اختياري)</span>
                <Input type="number" value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)}
                  placeholder="لا يوجد حد" dir="ltr" min="1" />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">تاريخ الانتهاء (اختياري)</span>
                <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} dir="ltr" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-600">وصف (اختياري)</span>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="عرض صيف 2024" />
              </label>
            </div>

            <div className="flex gap-2 pt-1">
              <Button onClick={() => createMut.mutate()} disabled={!code.trim() || (type !== "FREE_DELIVERY" && !value) || createMut.isPending} className="flex-1">
                {createMut.isPending ? "جاري الإنشاء..." : "إنشاء الكود"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>إلغاء</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="py-8 text-center text-sm text-slate-400">جاري التحميل...</div>
      ) : promos.length === 0 ? (
        <div className="py-12 text-center">
          <Ticket className="mx-auto mb-3 h-10 w-10 text-slate-200" />
          <p className="text-sm font-medium text-slate-500">لا توجد أكواد خصم</p>
          <p className="text-xs text-slate-400">اضغط «إنشاء كود» لإنشاء أول كود</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-3 text-right">الكود</th>
                <th className="px-4 py-3 text-right">النوع</th>
                <th className="px-4 py-3 text-right">الزبون</th>
                <th className="px-4 py-3 text-right">الاستخدام</th>
                <th className="px-4 py-3 text-right">الانتهاء</th>
                <th className="px-4 py-3 text-right">الحالة</th>
                <th className="px-4 py-3 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y bg-white">
              {promos.map((p) => (
                <tr key={p.id} className={cn("transition", !p.active && "opacity-50")}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-violet-100 px-2 py-0.5 font-mono text-xs font-bold text-violet-800">{p.code}</span>
                      {p.description && <span className="text-xs text-slate-400">{p.description}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold",
                      p.type === "FREE_DELIVERY" ? "bg-blue-100 text-blue-700"
                        : p.type === "PERCENT" ? "bg-orange-100 text-orange-700"
                          : "bg-emerald-100 text-emerald-700")}>
                      {p.type === "FREE_DELIVERY" ? "توصيل مجاني" : p.type === "PERCENT" ? `${p.value}%` : `${(p.value ?? 0).toLocaleString()} د.ع`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{p.customer ? p.customer.name : <span className="text-slate-400">الكل</span>}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {p.usedCount}{p.usageLimit ? `/${p.usageLimit}` : ""} مرة
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {p.expiresAt ? dayjs(p.expiresAt).format("YYYY/MM/DD") : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleMut.mutate({ id: p.id, active: !p.active })}
                      className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold transition",
                        p.active ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200")}>
                      {p.active ? "نشط" : "معطّل"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setDeleteId(p.id)} className="rounded-lg p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="حذف كود الخصم"
        description="هل أنت متأكد؟ لا يمكن التراجع."
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
        loading={deleteMut.isPending}
      />
    </div>
  )
}

/* ─── Catalog OTP re-verification toggle ──────────────────────────────── */
function CatalogOtpSettings() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    const s = settingsQuery.data
    if (!s) return
    setEnabled(s.catalogRequireOtp !== false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data])

  const saveMut = useMutation({
    mutationFn: (value: boolean) => updateSettings({ catalogRequireOtp: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] })
      toast({ title: "تم حفظ الإعداد" })
    },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر الحفظ"), variant: "destructive" }),
  })

  function toggle(checked: boolean) {
    setEnabled(checked)
    saveMut.mutate(checked)
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <ShieldOff className="h-4 w-4 text-slate-500" />
            تفعيل التحقق برمز واتساب عند دخول الكتالوك
          </p>
          <p className="mt-1 text-xs text-slate-500">
            عند إيقافه، يصبح رابط الكتالوك العام مفتوح للجميع بدون رقم أو رمز تحقق — الزبون المجهول يتصفح المنتجات
            بدون أسعار، وله زر لطلب تفعيل الأسعار، وعند الشراء يكتب اسمه ورقمه وعنوانه فيروح الطلب لموافقتك مباشرة.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          disabled={saveMut.isPending}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-blue-600"
        />
      </label>
    </div>
  )
}

/* ─── Global carton-only display toggle ─────────────────────────────── */
function CatalogFullCartonOnlySettings() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const s = settingsQuery.data
    if (!s) return
    setEnabled(s.catalogFullCartonOnly === true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data])

  const saveMut = useMutation({
    mutationFn: (value: boolean) => updateSettings({ catalogFullCartonOnly: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] })
      toast({ title: "تم حفظ الإعداد" })
    },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر الحفظ"), variant: "destructive" }),
  })

  function toggle(checked: boolean) {
    setEnabled(checked)
    saveMut.mutate(checked)
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Package className="h-4 w-4 text-slate-500" />
            عرض المواد المتوفرة بكارتون كامل فقط (لكل الزبائن)
          </p>
          <p className="mt-1 text-xs text-slate-500">
            عند التفعيل، أي مادة كميتها أقل من كارتون كامل تختفي من الكتالوج لجميع الزبائن — يتجاوز إعداد كل زبون
            المخصص. عند الإيقاف، تبقى إعدادات كل زبون كما هي.
          </p>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          disabled={saveMut.isPending}
          onChange={(e) => toggle(e.target.checked)}
          className="h-4 w-4 shrink-0 accent-blue-600"
        />
      </label>
    </div>
  )
}

const PAGE_SIZE = 50

/* ── Reshuffle interval setting ──────────────────────────────────────── */
function CatalogShuffleSettings() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const mode = (settingsQuery.data?.catalogShuffleMode as "hourly" | "daily" | "off" | undefined) ?? "hourly"

  const saveMut = useMutation({
    mutationFn: (value: "hourly" | "daily" | "off") => updateSettings({ catalogShuffleMode: value }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["settings"] }); toast({ title: "تم حفظ الإعداد" }) },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر الحفظ"), variant: "destructive" }),
  })

  const opts: Array<{ key: "hourly" | "daily" | "off"; label: string }> = [
    { key: "hourly", label: "كل ساعة" },
    { key: "daily", label: "كل يوم" },
    { key: "off", label: "ثابت" },
  ]

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Shuffle className="h-4 w-4 text-slate-500" />
            تبديل ترتيب عرض البضاعة تلقائياً
          </p>
          <p className="mt-1 text-xs text-slate-500">
            يعيد ترتيب المنتجات لكل الزبائن على نفس الفترة — يعطي فرصة عرض لكل البضاعة. «ثابت» يبقيها بالترتيب الأبجدي.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
          {opts.map((o) => (
            <button key={o.key} disabled={saveMut.isPending} onClick={() => saveMut.mutate(o.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                mode === o.key ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-700",
              )}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Guest visitors (phone-gate leads) ──────────────────────────────── */
// "125" -> "دقيقتين"-style would need a full Arabic pluralizer; keep it simple
// and numeric (still far more useful than nothing) — د for minutes, ث for seconds.
function formatDuration(totalSeconds: number) {
  if (!totalSeconds) return "—"
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds} ث`
  return `${minutes} د ${seconds ? `${seconds} ث` : ""}`.trim()
}

function VisitorsTab() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ["catalog-visitors"],
    queryFn: getCatalogVisitors,
    staleTime: 60_000,
  })
  const visitors = data?.visitors ?? []
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null)

  const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`

  const convertMut = useMutation({
    mutationFn: (phone: string) => convertCatalogVisitor(phone),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["catalog-visitors"] })
      qc.invalidateQueries({ queryKey: ["catalog-customers"] })
      toast({ title: r.created ? `تمت إضافة «${r.customerName}» كزبون` : `الرقم مسجّل مسبقاً: «${r.customerName}»` })
    },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر التحويل"), variant: "destructive" }),
  })

  function exportCsv() {
    const header = ["الرقم", "عدد الزيارات", "أول زيارة", "آخر زيارة", "زبون"]
    const rows = visitors.map((v) => [
      v.phone, String(v.visits),
      dayjs(v.firstSeenAt).format("YYYY-MM-DD"),
      dayjs(v.lastSeenAt).format("YYYY-MM-DD HH:mm"),
      v.customerName ?? "",
    ])
    const csv = "﻿" + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = url; a.download = `catalog-visitors-${dayjs().format("YYYY-MM-DD")}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="عدد الأرقام" value={data?.uniquePhones ?? 0} color="slate" />
        <StatCard label="إجمالي الزيارات" value={data?.totalVisits ?? 0} color="emerald" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!visitors.length}>
          <Download className="ml-1.5 h-4 w-4" /> تصدير Excel
        </Button>
        <Button size="sm" onClick={() => setBroadcastOpen(true)} disabled={!visitors.length}>
          <Send className="ml-1.5 h-4 w-4" /> إرسال واتساب جماعي
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> الأرقام التي دخلت الكتلوك
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-slate-400">جاري التحميل...</p>
          ) : visitors.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">لا توجد أرقام بعد</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-right text-xs text-slate-500">
                    <th className="p-2 font-medium">الرقم</th>
                    <th className="p-2 font-medium">عدد الزيارات</th>
                    <th className="p-2 font-medium">آخر زيارة</th>
                    <th className="p-2 font-medium">أول زيارة</th>
                    <th className="p-2 font-medium">مدة التصفح</th>
                    <th className="p-2 font-medium">الحالة</th>
                    <th className="p-2 font-medium">تواصل</th>
                    <th className="p-2 font-medium">شنو فتح</th>
                  </tr>
                </thead>
                <tbody>
                  {visitors.map((v) => (
                    <Fragment key={v.id}>
                    <tr className="border-b last:border-0">
                      <td className="p-2 font-mono" dir="ltr">{v.phone}</td>
                      <td className="p-2">{v.visits}</td>
                      <td className="p-2 text-slate-500">{dayjs(v.lastSeenAt).locale("ar").fromNow()}</td>
                      <td className="p-2 text-slate-500">{dayjs(v.firstSeenAt).format("YYYY-MM-DD")}</td>
                      <td className="p-2 text-slate-500">{formatDuration(v.totalTimeSeconds)}</td>
                      <td className="p-2">
                        {v.customerId ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                            <Check className="h-3 w-3" /> {v.customerName}
                          </span>
                        ) : (
                          <button onClick={() => convertMut.mutate(v.phone)} disabled={convertMut.isPending}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                            <UserPlus className="h-3 w-3" /> أضفه كزبون
                          </button>
                        )}
                      </td>
                      <td className="p-2">
                        <a href={waLink(v.phone)} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100">
                          <Phone className="h-3 w-3" /> واتساب
                        </a>
                      </td>
                      <td className="p-2">
                        <button
                          onClick={() => setExpandedPhone((cur) => (cur === v.phone ? null : v.phone))}
                          className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                        >
                          <Eye className="h-3 w-3" /> {expandedPhone === v.phone ? "إخفاء" : "عرض"}
                        </button>
                      </td>
                    </tr>
                    {expandedPhone === v.phone && (
                      <tr className="border-b bg-slate-50/60 last:border-0">
                        <td className="p-3" colSpan={8}>
                          <VisitorProductViewsList phone={v.phone} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {broadcastOpen && <BroadcastVisitorsModal count={data?.uniquePhones ?? 0} onClose={() => setBroadcastOpen(false)} />}
    </div>
  )
}

// Lazy-loaded per-visitor product view log — only fetched once its row is expanded.
function VisitorProductViewsList({ phone }: { phone: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["catalog-visitor-views", phone],
    queryFn: () => getVisitorProductViews(phone),
  })
  const views = data ?? []

  if (isLoading) return <p className="text-xs text-slate-400">جاري التحميل...</p>
  if (views.length === 0) return <p className="text-xs text-slate-400">ما فتح أي مادة بعد (فتح الصورة يسجّلها).</p>

  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-slate-500">آخر {views.length} مادة فتحها هذا الزبون:</p>
      <div className="flex flex-wrap gap-1.5">
        {views.map((view) => (
          <span key={view.id} className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 shadow-sm ring-1 ring-slate-200">
            {view.productName} <span className="text-slate-400">— {dayjs(view.viewedAt).locale("ar").fromNow()}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Bulk WhatsApp to collected numbers ──────────────────────────────── */
function BroadcastVisitorsModal({ count, onClose }: { count: number; onClose: () => void }) {
  const [message, setMessage] = useState("")
  const sendMut = useMutation({
    mutationFn: () => broadcastToCatalogVisitors(message.trim()),
    onSuccess: (r) => { toast({ title: `بدأ الإرسال إلى ${r.total} رقم — يتم بالتتابع لتجنّب الحظر` }); onClose() },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذر الإرسال"), variant: "destructive" }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-base font-bold text-slate-900">إرسال واتساب جماعي</h3>
        <p className="mb-3 text-xs text-slate-500">سيتم الإرسال إلى كل الأرقام المجمّعة ({count} رقم) عبر واتساب المتجر.</p>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5}
          placeholder="اكتب رسالتك هنا..." className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>إلغاء</Button>
          <Button size="sm" disabled={message.trim().length < 2 || sendMut.isPending} onClick={() => sendMut.mutate()}>
            {sendMut.isPending ? "جاري الإرسال..." : "إرسال للكل"}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── Catalog product analytics ───────────────────────────────────────── */
function AnalyticsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["catalog-product-stats"],
    queryFn: getCatalogProductStats,
    staleTime: 60_000,
  })

  const list = (rows: CatalogProductStat[], metric: "views" | "orders") => (
    rows.length === 0 ? (
      <p className="py-6 text-center text-sm text-slate-400">لا توجد بيانات بعد</p>
    ) : (
      <div className="space-y-2">
        {rows.map((p, i) => (
          <div key={p.productId} className="flex items-center gap-3 rounded-xl border border-slate-100 p-2">
            <span className="w-5 text-center text-xs font-bold text-slate-400">{i + 1}</span>
            {p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" className="h-9 w-9 rounded-lg object-cover" /> : <div className="h-9 w-9 rounded-lg bg-slate-100" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
              {p.itemNumber && <p className="text-xs text-slate-400" dir="ltr">#{p.itemNumber}</p>}
            </div>
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-700">{p[metric]}</span>
          </div>
        ))}
      </div>
    )
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="إجمالي المشاهدات" value={data?.totalViews ?? 0} color="slate" />
        <StatCard label="إجمالي الطلبات" value={data?.totalOrders ?? 0} color="emerald" />
      </div>
      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">جاري التحميل...</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4" /> الأكثر مشاهدة</CardTitle></CardHeader>
            <CardContent>{list(data?.topViewed ?? [], "views")}</CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" /> الأكثر طلباً</CardTitle></CardHeader>
            <CardContent>{list(data?.topOrdered ?? [], "orders")}</CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export function CatalogManagementPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN")
  const [tab, setTab] = useState<"customers" | "visitors" | "analytics" | "design" | "promos">("customers")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")       // debounced — sent to server
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "sentNotOpened">("all")
  const [page, setPage] = useState(0)

  // Debounce search so we don't hit the server on every keystroke
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleSearchChange(v: string) {
    setSearchInput(v)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => { setSearch(v); setPage(0) }, 350)
  }

  const { data, isLoading } = useQuery({
    queryKey: ["catalog-customers", search, page],
    queryFn: () => getCatalogCustomers({ search: search || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    staleTime: 3 * 60_000,
    placeholderData: (prev) => prev,
  })

  const customers = data?.rows ?? []
  const total = data?.total ?? 0

  // Client-side filter for has/no access (fast, only within the current page)
  const filtered = useMemo(() => {
    return customers.filter((c) => {
      if (filter === "active") return c.hasAccess
      if (filter === "inactive") return !c.hasAccess
      if (filter === "sentNotOpened") return isSentNotOpened(c)
      return true
    })
  }, [customers, filter])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6 p-6" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">إدارة كاتلوك الجملة</h1>
        <p className="mt-1 text-sm text-slate-500">تحكم بصلاحيات الزبائن والتصميم وأكواد الخصم</p>
      </div>

      <div className="space-y-3">
        <CatalogOtpSettings />
        <CatalogFullCartonOnlySettings />
        <CatalogShuffleSettings />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
        {([
          { key: "customers", label: "الزبائن", icon: <Globe className="h-4 w-4" /> },
          { key: "visitors", label: "الزوار الجدد", icon: <Users className="h-4 w-4" /> },
          { key: "analytics", label: "تحليلات الكتلوك", icon: <BarChart3 className="h-4 w-4" /> },
          { key: "design", label: "تصميم الكتلوك", icon: <Palette className="h-4 w-4" /> },
          { key: "promos", label: "البروموكود", icon: <Ticket className="h-4 w-4" /> },
        ] as const).map(({ key, label, icon }) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all",
              tab === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
            )}>
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === "visitors" && <VisitorsTab />}
      {tab === "analytics" && <AnalyticsTab />}
      {tab === "design" && <CatalogDesignTab />}
      {tab === "promos" && <PromoCodesTab />}

      {tab === "customers" && <>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="إجمالي الزبائن" value={total} color="slate" />
        <StatCard label="لديهم صلاحية" value={customers.filter(c => c.hasAccess).length} color="emerald" />
        <StatCard label="بدون صلاحية" value={customers.filter(c => !c.hasAccess).length} color="rose" />
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

      {/* Bulk catalog-link send by tag */}
      <BulkCatalogSend />

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
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all", "active", "inactive"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setPage(0) }}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                    filter === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                  )}
                >
                  {f === "all" ? "الكل" : f === "active" ? "لديهم صلاحية" : "بدون صلاحية"}
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
                  <th className="px-4 py-3 text-right">العرض</th>
                  <th className="px-4 py-3 text-right">آخر زيارة</th>
                  <th className="px-4 py-3 text-right">رابط الكتلوج (واتساب)</th>
                  <th className="px-4 py-3 text-right">إجراءات</th>
                </tr>
              </thead>
              <tbody className="bg-white">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">جاري التحميل...</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">لا توجد نتائج</td>
                  </tr>
                ) : (
                  filtered.map((customer) => (
                    <CustomerRow key={customer.id} customer={customer} isAdmin={!!isAdmin} />
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} من {total} زبون
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40 hover:bg-slate-50"
                >
                  السابق
                </button>
                <span className="flex items-center px-2 text-xs text-slate-500">
                  {page + 1} / {totalPages}
                </span>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(p => p + 1)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40 hover:bg-slate-50"
                >
                  التالي
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </>}
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
