import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { usePageTitle } from "../hooks/usePageTitle"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Archive,
  BadgePercent,
  BellRing,
  Building2,
  CheckCircle2,
  ClipboardList,
  Download,
  FileJson,
  HardDrive,
  ImagePlus,
  KeyRound,
  Loader2,
  MessageCircle,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Upload,
  Users,
  WifiOff,
  XCircle,
} from "lucide-react"
import {
  getCustomers,
  getInvoices,
  getMessageTemplates,
  getProducts,
  getSettings,
  getVouchers,
  getWhatsAppStatus,
  permanentDeleteInvoice,
  reactivateInvoice,
  restartWhatsApp,
  updateMessageTemplate,
  updateSettings,
  triggerManualBackup,
  triggerDailySummary,
  downloadFullBackup,
  sendBackupToTelegram,
} from "../api/endpoints"
import type { WhatsAppStatus } from "../api/endpoints"
import type { AppSettings, MessageTemplate } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { useTheme } from "../theme/ThemeProvider"
import { cn } from "../utils/cn"
import { ChangePasswordForm } from "../components/settings/ChangePasswordForm"
import { CatalogCategoriesManager } from "../components/CatalogCategoriesManager"

interface SeasonalAlert {
  id: string
  label: string
  month: number
  day: number
  daysBefore: number
  enabled: boolean
}

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"]

function parseSeasonalAlerts(raw?: string): SeasonalAlert[] {
  try { return raw ? (JSON.parse(raw) as SeasonalAlert[]) : [] } catch { return [] }
}

const DEFAULT_SEASONAL_ALERTS: SeasonalAlert[] = [
  { id: "eid-al-fitr",   label: "عيد الفطر",          month: 4,  day: 10, daysBefore: 30, enabled: true },
  { id: "eid-al-adha",   label: "عيد الأضحى",         month: 6,  day: 16, daysBefore: 30, enabled: true },
  { id: "chinese-new-year", label: "رأس السنة الصينية", month: 1, day: 29, daysBefore: 90, enabled: false },
  { id: "new-year",      label: "رأس السنة الميلادية", month: 1,  day: 1,  daysBefore: 14, enabled: false },
  { id: "ramadan",       label: "شهر رمضان",           month: 3,  day: 1,  daysBefore: 45, enabled: true },
]

const WA_PLACEHOLDERS = [
  "{{customerName}}", "{{invoiceNumber}}", "{{voucherNumber}}", "{{amount}}",
  "{{total}}", "{{paid}}", "{{remaining}}", "{{finalBalance}}",
  "{{currentBalance}}", "{{openingBalance}}", "{{date}}", "{{currency}}", "{{storeName}}",
]

const fallbackSettings: AppSettings = {
  storeName: "مخزوني",
  storeLogo: "",
  storePhone: "",
  storeAddress: "",
  currency: "IQD",
  debtReminderDays: 14,
  inactiveCustomerDays: 30,
  autoSendDebtReminder: false,
  autoSendInactiveMessage: false,
  invoiceTemplate: "",
  voucherTemplate: "",
  statementTemplate: "",
  catalogPublicUrl: "https://inventory-web-six-kohl.vercel.app/catalog",
  catalogAdminWhatsappNumber: "",
  orderPreparationWhatsappNumbers: "",
  autoSendDailySummary: false,
  dailySummaryWhatsappNumber: "",
  dailySummaryHour: 21,
  whatsappProvider: "web",
  whatsappCloudToken: "",
  whatsappCloudPhoneNumberId: "",
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function toCsv<T extends object>(rows: T[]) {
  if (rows.length === 0) return ""
  const headers = Object.keys(rows[0] as Record<string, unknown>)
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`
  return [headers.join(","), ...rows.map((row) => {
    const r = row as Record<string, unknown>
    return headers.map((h) => esc(r[h])).join(",")
  })].join("\n")
}

type SettingsTab = "store" | "theme" | "whatsapp" | "alerts" | "backup" | "security" | "admin" | "archive"

const TABS: { id: SettingsTab; label: string; icon: typeof Building2 }[] = [
  { id: "store",    label: "المتجر",        icon: Building2 },
  { id: "theme",    label: "المظهر",        icon: Palette },
  { id: "whatsapp", label: "واتساب",        icon: MessageCircle },
  { id: "alerts",   label: "التنبيهات",     icon: BellRing },
  { id: "security", label: "الأمان",        icon: KeyRound },
  { id: "backup",   label: "النسخ الاحتياطي", icon: Download },
  { id: "admin",    label: "الإدارة",       icon: ShieldCheck },
  { id: "archive",  label: "الأرشيف",       icon: Archive },
]

export function SettingsPage() {
  usePageTitle("الإعدادات")
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<SettingsTab>("store")
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [importMsg, setImportMsg] = useState("")
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const waQuery = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: getWhatsAppStatus,
    refetchInterval: (query) => {
      const s = query.state.data?.state
      if (s === "QR" || s === "INITIALIZING") return 3_000
      if (s === "READY") return 60_000
      return false
    },
    enabled: activeTab === "whatsapp",
  })
  const templatesQuery = useQuery({ queryKey: ["message-templates"], queryFn: getMessageTemplates })
  const productsQuery = useQuery({ queryKey: ["products", "backup"], queryFn: () => getProducts() })
  const customersQuery = useQuery({ queryKey: ["customers", "backup"], queryFn: () => getCustomers() })
  const [saved, setSaved] = useState(false)
  const [backupMsg, setBackupMsg] = useState("")
  const [summaryMsg, setSummaryMsg] = useState("")
  const [downloadMsg, setDownloadMsg] = useState("")
  const [telegramMsg, setTelegramMsg] = useState("")
  const [downloadPending, setDownloadPending] = useState(false)

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (settingsQuery.data) setSettings({ ...fallbackSettings, ...settingsQuery.data }) }, [settingsQuery.data])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (templatesQuery.data) setTemplates(templatesQuery.data) }, [templatesQuery.data])

  const saveSettings = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const saveTemplate = useMutation({
    mutationFn: (t: MessageTemplate) => updateMessageTemplate(t.id, t),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["message-templates"] }),
  })

  const waRestartMutation = useMutation({
    mutationFn: restartWhatsApp,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-status"] }),
  })

  const dailySummaryMutation = useMutation({
    mutationFn: triggerDailySummary,
    onSuccess: (res) => {
      const wa = (res.data as { whatsappResult?: string })?.whatsappResult ?? ""
      const msg = (res.data as { message?: string })?.message ?? ""
      setSummaryMsg(wa ? `${wa}\n\n${msg}` : msg || "✓ تم")
    },
    onError: () => setSummaryMsg("✗ فشل إرسال الملخص"),
  })

  const backupMutation = useMutation({
    mutationFn: triggerManualBackup,
    onSuccess: (res) => {
      const d = res.data
      setBackupMsg(d ? `✓ تم: ${d.products} منتج، ${d.customers} زبون، ${d.invoices} فاتورة، ${d.vouchers} سند` : "✓ تم النسخ الاحتياطي")
    },
    onError: () => setBackupMsg("✗ فشل النسخ الاحتياطي"),
  })

  const telegramBackupMutation = useMutation({
    mutationFn: sendBackupToTelegram,
    onSuccess: (res) => setTelegramMsg(`✓ ${res.message ?? "تم الإرسال لتيليغرام"}`),
    onError: (err: Error) => setTelegramMsg(`✗ ${err.message}`),
  })

  async function handleDownloadBackup() {
    setDownloadPending(true)
    setDownloadMsg("")
    try {
      await downloadFullBackup()
      setDownloadMsg("✓ تم تحميل النسخة الكاملة")
    } catch {
      setDownloadMsg("✗ فشل تحميل النسخة")
    } finally {
      setDownloadPending(false)
    }
  }

  const backup = useMemo(() => ({
    exportedAt: new Date().toISOString(),
    settings,
    messageTemplates: templates,
    products: productsQuery.data ?? [],
    customers: customersQuery.data ?? [],
  }), [customersQuery.data, productsQuery.data, settings, templates])

  function upd<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  function uploadLogo(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => upd("storeLogo", String(reader.result ?? ""))
    reader.readAsDataURL(file)
  }

  function importBackup(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? "{}")) as Partial<typeof backup>
        if (parsed.settings) setSettings({ ...fallbackSettings, ...parsed.settings })
        if (Array.isArray(parsed.messageTemplates)) setTemplates(parsed.messageTemplates)
        setImportMsg(`✓ تم استيراد: ${file.name}`)
      } catch {
        setImportMsg("✗ ملف غير صالح")
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">الإعدادات</h1>
        <p className="text-sm text-slate-500">تخصيص المتجر، المظهر، والقوالب.</p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = t.id === activeTab
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── STORE ──────────────────────────────────────────── */}
      {activeTab === "store" && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <SectionTitle>بيانات المتجر</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="اسم المتجر">
                <Input value={settings.storeName} onChange={(e) => upd("storeName", e.target.value)} placeholder="مخزوني" />
              </Field>
              <Field label="الهاتف">
                <Input value={settings.storePhone} onChange={(e) => upd("storePhone", e.target.value)} placeholder="+964..." />
              </Field>
              <Field label="العنوان">
                <Input value={settings.storeAddress} onChange={(e) => upd("storeAddress", e.target.value)} placeholder="بغداد..." />
              </Field>
              <Field label="العملة">
                <Input value={settings.currency} onChange={(e) => upd("currency", e.target.value)} placeholder="IQD" />
              </Field>
            </div>
            <Field label="شعار المتجر">
              <div className="flex items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                  <ImagePlus className="h-4 w-4" />
                  رفع الشعار
                  <input className="hidden" type="file" accept="image/*" onChange={(e) => uploadLogo(e.target.files?.[0])} />
                </label>
                {settings.storeLogo ? <img src={settings.storeLogo} alt="logo" className="h-14 w-14 rounded-lg object-cover border border-slate-200" /> : null}
              </div>
            </Field>
            <SaveRow onSave={() => saveSettings.mutate(settings)} isPending={saveSettings.isPending} saved={saved} />
          </CardContent>
        </Card>
      )}

      {/* ── THEME ──────────────────────────────────────────── */}
      {activeTab === "theme" && <ThemePanel />}

      {activeTab === "security" && (
        <ChangePasswordForm />
      )}

      {/* ── ADMIN ──────────────────────────────────────────── */}
      {activeTab === "admin" && (
        <>
        <CatalogCategoriesManager />
        <Card>
          <CardContent className="p-5 space-y-3">
            <SectionTitle>أدوات الإدارة</SectionTitle>
            <p className="text-sm text-slate-500">إدارة المستخدمين، الصلاحيات، الفروع، والكوبونات.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { to: "/users",      label: "المستخدمين",   desc: "إدارة حسابات المستخدمين والصلاحيات", Icon: Users },
                { to: "/audit-logs", label: "سجل التدقيق",  desc: "مراجعة جميع العمليات والتغييرات",     Icon: ClipboardList },
                { to: "/branches",   label: "الفروع",        desc: "إضافة وتعديل الفروع",                 Icon: Building2 },
                { to: "/coupons",    label: "الكوبونات",     desc: "إنشاء وإدارة كوبونات الخصم",          Icon: BadgePercent },
              ] as const).map(({ to, label, desc, Icon }) => (
                <Link key={to} to={to}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-700 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
                    <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
        </>
      )}

      {/* ── WHATSAPP ───────────────────────────────────────── */}
      {activeTab === "whatsapp" && (
        <>
        <WhatsAppConnectCard status={waQuery.data ?? null} onRestart={() => waRestartMutation.mutate()} restarting={waRestartMutation.isPending} />
        <Card>
          <CardContent className="p-5 space-y-4">
            <SectionTitle>تنبيهات الكتالوج وتجهيز الطلبات</SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="رقمك الخاص لاستقبال طلبات الكتالوج">
                <Input
                  value={settings.catalogAdminWhatsappNumber ?? ""}
                  onChange={(e) => upd("catalogAdminWhatsappNumber", e.target.value)}
                  placeholder="9647xxxxxxxx"
                  dir="ltr"
                />
              </Field>
              <Field label="رابط الكتالوج العام">
                <Input
                  value={settings.catalogPublicUrl ?? ""}
                  onChange={(e) => upd("catalogPublicUrl", e.target.value)}
                  placeholder="https://inventory-web-six-kohl.vercel.app/catalog"
                  dir="ltr"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="أرقام موظفين التجهيز">
                  <textarea
                    className="min-h-24 w-full rounded-md border bg-white p-2 text-sm outline-none focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                    value={settings.orderPreparationWhatsappNumbers ?? ""}
                    onChange={(e) => upd("orderPreparationWhatsappNumbers", e.target.value)}
                    placeholder={"9647xxxxxxxx\n9647xxxxxxxx"}
                    dir="ltr"
                  />
                </Field>
                <p className="mt-1 text-xs text-slate-500">
                  اكتب كل رقم بسطر، أو افصل الأرقام بفارزة. إذا تركت رقمك الخاص فارغ يستخدم رقم النسخ الاحتياطي كبديل.
                </p>
              </div>
              <div className="md:col-span-2">
                <Field label="رقم موافقات المدير (واتساب)">
                  <Input
                    value={settings.adminApprovalWhatsappNumber ?? ""}
                    onChange={(e) => upd("adminApprovalWhatsappNumber", e.target.value)}
                    placeholder="9647xxxxxxxx"
                    dir="ltr"
                  />
                </Field>
                <p className="mt-1 text-xs text-slate-500">
                  يصله إشعار واتساب بكل طلب حذف/تعطيل من الموظفين (اسم الموظف، العملية، السجل، الوقت). إذا تركته فارغ يُرسل لرقم المتجر.
                </p>
              </div>
            </div>
            <SaveRow
              onSave={() => saveSettings.mutate({
                catalogAdminWhatsappNumber: settings.catalogAdminWhatsappNumber,
                catalogPublicUrl: settings.catalogPublicUrl,
                orderPreparationWhatsappNumbers: settings.orderPreparationWhatsappNumbers,
                adminApprovalWhatsappNumber: settings.adminApprovalWhatsappNumber,
              })}
              isPending={saveSettings.isPending}
              saved={saved}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-4">
            <SectionTitle>إعداد واتساب Cloud API للإنتاج</SectionTitle>
            <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300 space-y-1">
              <p className="font-semibold">لإرسال الواتساب من السيرفر السحابي (Railway) بشكل موثوق:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>اذهب إلى <strong>Meta for Developers</strong> وأنشئ تطبيقاً من نوع WhatsApp Business</li>
                <li>احصل على <strong>Access Token</strong> و<strong>Phone Number ID</strong></li>
                <li>أدخلهم أدناه واختر "Cloud API"</li>
                <li>فعّل <code className="rounded bg-blue-100 px-1 dark:bg-blue-900">ENABLE_WHATSAPP=true</code> في Railway</li>
              </ol>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="نوع الاتصال">
                <select
                  className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                  value={settings.whatsappProvider ?? "web"}
                  onChange={(e) => upd("whatsappProvider", e.target.value as "web" | "cloud")}
                >
                  <option value="web">رمز QR — محلي فقط</option>
                  <option value="cloud">Cloud API — موصى به للإنتاج</option>
                </select>
              </Field>
              <Field label="Phone Number ID">
                <Input
                  value={settings.whatsappCloudPhoneNumberId ?? ""}
                  onChange={(e) => upd("whatsappCloudPhoneNumberId", e.target.value)}
                  placeholder="123456789012345"
                  dir="ltr"
                />
              </Field>
              <div className="md:col-span-2">
                <Field label="Access Token">
                  <Input
                    type="password"
                    value={settings.whatsappCloudToken ?? ""}
                    onChange={(e) => upd("whatsappCloudToken", e.target.value)}
                    placeholder="EAAxxxxx..."
                    dir="ltr"
                  />
                </Field>
              </div>
            </div>
            <SaveRow
              onSave={() => saveSettings.mutate({
                whatsappProvider: settings.whatsappProvider,
                whatsappCloudToken: settings.whatsappCloudToken,
                whatsappCloudPhoneNumberId: settings.whatsappCloudPhoneNumberId,
              })}
              isPending={saveSettings.isPending}
              saved={saved}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 space-y-4">
            <SectionTitle>قوالب رسائل الواتساب</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {WA_PLACEHOLDERS.map((v) => (
                <span key={v} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">{v}</span>
              ))}
            </div>
            <div className="space-y-3">
              <TemplateField
                label="قالب الفاتورة 🧾"
                value={settings.invoiceTemplate ?? ""}
                onChange={(v) => upd("invoiceTemplate", v)}
              />
              <TemplateField
                label="قالب السند 🧾"
                value={settings.voucherTemplate ?? ""}
                onChange={(v) => upd("voucherTemplate", v)}
              />
              <TemplateField
                label="قالب كشف الحساب 📊"
                value={settings.statementTemplate ?? ""}
                onChange={(v) => upd("statementTemplate", v)}
              />
            </div>
            <SaveRow
              onSave={() => saveSettings.mutate({
                invoiceTemplate: settings.invoiceTemplate,
                voucherTemplate: settings.voucherTemplate,
                statementTemplate: settings.statementTemplate,
              })}
              isPending={saveSettings.isPending}
              saved={saved}
            />

            {/* Legacy message templates */}
            {templates.length > 0 ? (
              <>
                <hr className="border-slate-200 dark:border-slate-700" />
                <SectionTitle>قوالب قديمة</SectionTitle>
                {templates.map((t) => (
                  <div key={t.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium">{t.name}</span>
                      <Button size="sm" variant="outline" onClick={() => saveTemplate.mutate(t)} disabled={saveTemplate.isPending}>حفظ</Button>
                    </div>
                    <textarea
                      className="min-h-24 w-full rounded-md border bg-white p-2 text-sm outline-none focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
                      value={t.body}
                      onChange={(e) => setTemplates((prev) => prev.map((x) => x.id === t.id ? { ...x, body: e.target.value } : x))}
                    />
                  </div>
                ))}
              </>
            ) : null}
          </CardContent>
        </Card>
        </>
      )}

      {/* ── ALERTS ─────────────────────────────────────────── */}
      {activeTab === "alerts" && (
        <div className="space-y-4">
          {/* Existing alerts */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <SectionTitle>التنبيهات الذكية</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle label="تفعيل تذكير الديون" checked={settings.autoSendDebtReminder} onChange={(v) => upd("autoSendDebtReminder", v)} />
                <Field label="عدد أيام التأخر للتذكير">
                  <Input type="number" value={settings.debtReminderDays} onChange={(e) => upd("debtReminderDays", Number(e.target.value))} />
                </Field>
                <Toggle label="تفعيل تنبيه الغياب" checked={settings.autoSendInactiveMessage} onChange={(v) => upd("autoSendInactiveMessage", v)} />
                <Field label="عدد أيام الغياب للتنبيه">
                  <Input type="number" value={settings.inactiveCustomerDays} onChange={(e) => upd("inactiveCustomerDays", Number(e.target.value))} />
                </Field>
              </div>
              <SaveRow onSave={() => saveSettings.mutate(settings)} isPending={saveSettings.isPending} saved={saved} />
            </CardContent>
          </Card>

          {/* Daily WhatsApp summary */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <SectionTitle>📊 الملخص اليومي عبر الواتساب</SectionTitle>
              <p className="text-sm text-slate-500">
                يُرسل تلقائياً كل يوم في الساعة المحددة: مبيعات اليوم، أكثر منتج باع، منتجات على وشك النفاد، التحصيلات، الديون المتأخرة، ونصيحة ذكية.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="تفعيل الملخص اليومي"
                  checked={settings.autoSendDailySummary ?? false}
                  onChange={(v) => upd("autoSendDailySummary", v)}
                />
                <Field label="ساعة الإرسال (0–23)">
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={settings.dailySummaryHour ?? 21}
                    onChange={(e) => upd("dailySummaryHour", Number(e.target.value))}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="رقم الواتساب للملخص">
                    <Input
                      value={settings.dailySummaryWhatsappNumber ?? ""}
                      onChange={(e) => upd("dailySummaryWhatsappNumber", e.target.value)}
                      placeholder="9647xxxxxxxx"
                      dir="ltr"
                    />
                  </Field>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <SaveRow onSave={() => saveSettings.mutate(settings)} isPending={saveSettings.isPending} saved={saved} />
                <Button
                  variant="outline"
                  onClick={() => { setSummaryMsg(""); dailySummaryMutation.mutate(); }}
                  disabled={dailySummaryMutation.isPending}
                >
                  <Play className="h-4 w-4" />
                  {dailySummaryMutation.isPending ? "جاري الإرسال..." : "إرسال ملخص الآن"}
                </Button>
              </div>
              {summaryMsg ? (
                <pre className={`rounded-md px-3 py-2 text-xs whitespace-pre-wrap font-sans ${summaryMsg.startsWith("✓") ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}>
                  {summaryMsg}
                </pre>
              ) : null}
            </CardContent>
          </Card>

          {/* Seasonal alerts */}
          <SeasonalAlertsCard
            raw={settings.seasonalAlerts}
            onChange={(v) => upd("seasonalAlerts", v)}
            onSave={() => saveSettings.mutate(settings)}
            isPending={saveSettings.isPending}
            saved={saved}
          />
        </div>
      )}

      {/* ── BACKUP ─────────────────────────────────────────── */}
      {activeTab === "backup" && (
        <div className="space-y-4">

          {/* ── One-click full download ── */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <SectionTitle>نسخة احتياطية كاملة — زر واحد</SectionTitle>
              <p className="text-sm text-slate-500">
                يُصدّر جميع البيانات: المنتجات، الزبائن، الفواتير، السندات، عروض الأسعار، الإعدادات، الموظفين، الفروع… كل شيء في ملف JSON واحد.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleDownloadBackup}
                  disabled={downloadPending}
                  className="gap-2 bg-[var(--theme-accent)] hover:opacity-90 text-white"
                >
                  {downloadPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
                  {downloadPending ? "جاري التصدير..." : "تحميل نسخة كاملة من السيرفر"}
                </Button>
                {downloadMsg && (
                  <span className={`text-sm ${downloadMsg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>
                    {downloadMsg}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Telegram delivery ── */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <SectionTitle>إرسال النسخة لتيليغرام</SectionTitle>
              <p className="text-sm text-slate-500">
                أنشئ بوت تيليغرام عبر @BotFather، احصل على التوكن، ثم أرسل أي رسالة للبوت واستخدم @userinfobot لمعرفة Chat ID.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Telegram Bot Token">
                  <Input
                    value={settings.telegramBotToken ?? ""}
                    onChange={(e) => upd("telegramBotToken", e.target.value)}
                    placeholder="123456789:AAF..."
                    dir="ltr"
                    type="password"
                  />
                </Field>
                <Field label="Chat ID (رقمك أو ID المجموعة)">
                  <Input
                    value={settings.telegramChatId ?? ""}
                    onChange={(e) => upd("telegramChatId", e.target.value)}
                    placeholder="-1001234567890"
                    dir="ltr"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => telegramBackupMutation.mutate()}
                  disabled={telegramBackupMutation.isPending || !settings.telegramBotToken || !settings.telegramChatId}
                  variant="outline"
                  className="gap-2"
                >
                  {telegramBackupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {telegramBackupMutation.isPending ? "جاري الإرسال..." : "إرسال نسخة الآن لتيليغرام"}
                </Button>
                {telegramMsg && (
                  <span className={`text-sm ${telegramMsg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>
                    {telegramMsg}
                  </span>
                )}
              </div>
              <SaveRow onSave={() => saveSettings.mutate(settings)} isPending={saveSettings.isPending} saved={saved} />
            </CardContent>
          </Card>

          {/* ── Scheduled auto backup ── */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <SectionTitle>النسخ الاحتياطي التلقائي (كل أحد 02:00)</SectionTitle>
              <p className="text-sm text-slate-500">
                يُحفظ تلقائياً على السيرفر (آخر 8 نسخ). يمكن إرسال ملخص عبر واتساب إلى رقم صاحب العمل.
              </p>
              <Field label="رقم واتساب لاستقبال ملخص النسخة (اختياري)">
                <Input
                  value={settings.backupWhatsappNumber ?? ""}
                  onChange={(e) => upd("backupWhatsappNumber", e.target.value)}
                  placeholder="9647xxxxxxxx"
                  dir="ltr"
                />
              </Field>
              <div className="flex items-center gap-3">
                <Button onClick={() => backupMutation.mutate()} disabled={backupMutation.isPending} variant="outline">
                  <Play className="h-4 w-4" />
                  {backupMutation.isPending ? "جاري النسخ..." : "تشغيل نسخة السيرفر الآن"}
                </Button>
                {backupMsg && (
                  <span className={`text-sm ${backupMsg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>
                    {backupMsg}
                  </span>
                )}
              </div>
              <SaveRow onSave={() => saveSettings.mutate(settings)} isPending={saveSettings.isPending} saved={saved} />
            </CardContent>
          </Card>

          {/* ── CSV exports ── */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <SectionTitle>تصدير CSV</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button variant="outline" onClick={() => downloadText("products.csv", toCsv(productsQuery.data ?? []), "text/csv;charset=utf-8")}>
                  <Download className="h-4 w-4" /> المنتجات CSV
                </Button>
                <Button variant="outline" onClick={() => downloadText("customers.csv", toCsv(customersQuery.data ?? []), "text/csv;charset=utf-8")}>
                  <Download className="h-4 w-4" /> الزبائن CSV
                </Button>
                <Button variant="outline" onClick={() => downloadText("inventory-backup.json", JSON.stringify(backup, null, 2), "application/json")}>
                  <FileJson className="h-4 w-4" /> تصدير إعدادات JSON
                </Button>
                <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-4 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                  <Upload className="h-4 w-4" /> استيراد إعدادات من ملف
                  <input className="hidden" type="file" accept="application/json" onChange={(e) => importBackup(e.target.files?.[0])} />
                </label>
              </div>
              {importMsg && (
                <div className={`rounded-md px-3 py-2 text-sm ${importMsg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{importMsg}</div>
              )}
            </CardContent>
          </Card>

        </div>
      )}

      {/* ── ARCHIVE ────────────────────────────────────────── */}
      {activeTab === "archive" && (
        <ArchivePanel queryClient={queryClient} />
      )}
    </div>
  )
}

// ── Archive Panel ────────────────────────────────────────────────────────────

function ArchivePanel({ queryClient }: { queryClient: ReturnType<typeof useQueryClient> }) {
  const [archiveTab, setArchiveTab] = useState<"invoices" | "vouchers">("invoices")

  const cancelledInvoicesQuery = useQuery({
    queryKey: ["invoices", "cancelled"],
    queryFn: () => getInvoices({ status: "CANCELLED", limit: 200 }),
    enabled: archiveTab === "invoices",
  })

  const cancelledVouchersQuery = useQuery({
    queryKey: ["vouchers", "cancelled"],
    queryFn: () => getVouchers({ showCancelled: true, limit: 200 }),
    enabled: archiveTab === "vouchers",
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateInvoice(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: string) => permanentDeleteInvoice(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  })

  const cancelledInvoices = cancelledInvoicesQuery.data ?? []
  const cancelledVouchers = cancelledVouchersQuery.data ?? []

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <SectionTitle>الأرشيف — الفواتير والسندات الملغاة</SectionTitle>
        <p className="text-sm text-slate-500">
          عرض الفواتير والسندات المعطلة. يمكنك إرجاعها نشطة أو حذفها نهائياً.
        </p>

        {/* Sub-tabs */}
        <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 pb-0">
          {(["invoices", "vouchers"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setArchiveTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                archiveTab === t
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t === "invoices" ? "الفواتير الملغاة" : "السندات الملغاة"}
            </button>
          ))}
        </div>

        {/* Cancelled Invoices */}
        {archiveTab === "invoices" && (
          <>
            {cancelledInvoicesQuery.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : cancelledInvoices.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">لا توجد فواتير ملغاة</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                {cancelledInvoices.map((inv: any) => (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-white dark:bg-slate-950">
                    <div>
                      <span className="font-semibold text-sm text-rose-600">{inv.invoiceNumber}</span>
                      <span className="mx-2 text-slate-400">—</span>
                      <span className="text-sm">{inv.customer?.name ?? "—"}</span>
                      <span className="mr-3 text-xs text-slate-400">{String(inv.date).slice(0, 10)}</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                        disabled={reactivateMutation.isPending}
                        onClick={() => reactivateMutation.mutate(inv.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> إرجاع نشطة
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-300 hover:bg-red-50"
                        disabled={permanentDeleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`حذف ${inv.invoiceNumber} نهائياً؟ لا يمكن التراجع.`)) {
                            permanentDeleteMutation.mutate(inv.id)
                          }
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5" /> حذف نهائي
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Cancelled Vouchers */}
        {archiveTab === "vouchers" && (
          <>
            {cancelledVouchersQuery.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : cancelledVouchers.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">لا توجد سندات ملغاة</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                {cancelledVouchers.map((v: any) => (
                  <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-white dark:bg-slate-950">
                    <div>
                      <span className="font-semibold text-sm text-rose-600">{v.voucherNumber}</span>
                      <span className="mx-2 text-slate-400">—</span>
                      <span className="text-sm">{v.customer?.name ?? v.description ?? "—"}</span>
                      <span className="mr-3 text-xs text-slate-400">{String(v.date).slice(0, 10)}</span>
                    </div>
                    <span className="text-xs bg-rose-100 text-rose-700 rounded-full px-2 py-0.5">ملغى</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SeasonalAlertsCard({ raw, onChange, onSave, isPending, saved }: {
  raw?: string
  onChange: (v: string) => void
  onSave: () => void
  isPending: boolean
  saved: boolean
}) {
  const [alerts, setAlerts] = useState<SeasonalAlert[]>(() => {
    const parsed = parseSeasonalAlerts(raw)
    return parsed.length > 0 ? parsed : DEFAULT_SEASONAL_ALERTS
  })
  const [newLabel, setNewLabel] = useState("")
  const [newMonth, setNewMonth] = useState(1)
  const [newDay, setNewDay] = useState(1)
  const [newDaysBefore, setNewDaysBefore] = useState(30)
  const [adding, setAdding] = useState(false)

  function sync(next: SeasonalAlert[]) {
    setAlerts(next)
    onChange(JSON.stringify(next))
  }

  function toggle(id: string) {
    sync(alerts.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a))
  }

  function remove(id: string) {
    sync(alerts.filter((a) => a.id !== id))
  }

  function addAlert() {
    if (!newLabel.trim()) return
    const entry: SeasonalAlert = {
      id: `custom-${Date.now()}`,
      label: newLabel.trim(),
      month: newMonth,
      day: newDay,
      daysBefore: newDaysBefore,
      enabled: true,
    }
    sync([...alerts, entry])
    setNewLabel(""); setNewMonth(1); setNewDay(1); setNewDaysBefore(30); setAdding(false)
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <SectionTitle>🗓️ تنبيهات المواسم والمناسبات</SectionTitle>
        <p className="text-sm text-slate-500">
          تذكيرات قبل المناسبات والمواسم التجارية بعدد الأيام المحددة — تظهر في لوحة التحكم عند الاقتراب.
        </p>
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={() => toggle(a.id)}
                className="h-4 w-4 accent-indigo-600"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{a.label}</div>
                <div className="text-xs text-slate-500">
                  {a.day} {MONTHS_AR[a.month - 1]} · تنبيه قبل {a.daysBefore} يوم
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(a.id)}
                className="text-rose-400 hover:text-rose-600 text-xs px-2"
                title="حذف"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {adding ? (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-2 dark:border-indigo-800 dark:bg-indigo-950/20">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="اسم المناسبة" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              <div className="flex gap-2">
                <select
                  className="flex-1 h-10 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  value={newMonth}
                  onChange={(e) => setNewMonth(Number(e.target.value))}
                >
                  {MONTHS_AR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  placeholder="يوم"
                  className="w-20"
                  value={newDay}
                  onChange={(e) => setNewDay(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">تنبيه قبل:</label>
              <Input
                type="number"
                min={1}
                max={180}
                className="w-24"
                value={newDaysBefore}
                onChange={(e) => setNewDaysBefore(Number(e.target.value))}
              />
              <span className="text-xs text-slate-500">يوم</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={addAlert}>إضافة</Button>
              <Button size="sm" variant="outline" onClick={() => setAdding(false)}>إلغاء</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> إضافة مناسبة
          </Button>
        )}

        <SaveRow onSave={onSave} isPending={isPending} saved={saved} />
      </CardContent>
    </Card>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold">{children}</h2>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

function SaveRow({ onSave, isPending, saved }: { onSave: () => void; isPending: boolean; saved: boolean }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <Button onClick={onSave} disabled={isPending}>
        <Save className="h-4 w-4" /> حفظ التغييرات
      </Button>
      {saved ? <span className="text-sm text-emerald-600">✓ تم الحفظ</span> : null}
    </div>
  )
}

function ThemePanel() {
  const { themeId, setThemeId, presets, fontId, setFontId, fontDefs, customOverrides, setCustomOverrides } = useTheme()

  return (
    <div className="space-y-6">
      {/* ── Preset Themes ─── */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <SectionTitle>ثيمات التطبيق</SectionTitle>
            <p className="text-xs text-slate-500 mt-0.5">اختر الثيم وستتغير جميع الألوان تلقائياً.</p>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {presets.filter((t) => t.id !== "custom").map((t) => {
              const active = themeId === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setThemeId(t.id)}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border-2 text-right transition-all hover:scale-[1.03] hover:shadow-lg",
                    active ? "ring-2" : "border-slate-200 dark:border-slate-700 hover:border-slate-300",
                  )}
                  style={active ? { borderColor: t.vars.accent, "--tw-ring-color": t.vars.accent } as React.CSSProperties : {}}
                >
                  {/* Mini app preview */}
                  <div className="flex h-16 overflow-hidden">
                    {/* Sidebar strip */}
                    <div className="w-5 shrink-0 flex flex-col gap-0.5 p-1" style={{ background: t.vars.sidebar }}>
                      {[1,2,3,4].map((i) => (
                        <div key={i} className="h-1.5 rounded-sm opacity-50" style={{ background: t.vars.sidebarText, width: i === 1 ? "100%" : `${60 + i*8}%` }} />
                      ))}
                    </div>
                    {/* Page area */}
                    <div className="flex-1 p-1.5" style={{ background: t.vars.pageBg }}>
                      <div className="h-2 w-10 rounded mb-1" style={{ background: t.vars.accent, opacity: 0.9 }} />
                      <div className="h-1.5 w-full rounded mb-0.5" style={{ background: t.vars.cardBorder }} />
                      <div className="h-1.5 w-3/4 rounded" style={{ background: t.vars.cardBorder }} />
                    </div>
                  </div>
                  {/* Preview dots */}
                  <div className="flex gap-0.5 px-2 py-1.5 bg-white dark:bg-slate-900">
                    {[t.vars.accent, t.vars.sale, t.vars.receipt, t.vars.payment].map((c, i) => (
                      <div key={i} className="h-2 w-2 rounded-full" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="px-2 pb-2 bg-white dark:bg-slate-900">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold truncate" style={{ color: t.vars.textPrimary }}>{t.label}</span>
                      {active && <span className="text-[9px] font-bold text-emerald-600">✓</span>}
                    </div>
                  </div>
                  {active && (
                    <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ boxShadow: `inset 0 0 0 2px ${t.vars.accent}` }} />
                  )}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Custom Theme Builder ─── */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <SectionTitle>ثيم مخصص 🎛️</SectionTitle>
              <p className="text-xs text-slate-500 mt-0.5">اختر ألوان شركتك بالضبط.</p>
            </div>
            <button
              type="button"
              onClick={() => setThemeId("custom")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                themeId === "custom"
                  ? "bg-violet-600 text-white"
                  : "border border-violet-300 text-violet-700 hover:bg-violet-50",
              )}
            >
              {themeId === "custom" ? "✓ مفعّل" : "تفعيل"}
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <ColorPicker
              label="لون الأساس"
              value={customOverrides.accent ?? "#7c3aed"}
              onChange={(v) => setCustomOverrides({ ...customOverrides, accent: v })}
            />
            <ColorPicker
              label="لون الشريط الجانبي"
              value={customOverrides.sidebar ?? "#1e1b4b"}
              onChange={(v) => setCustomOverrides({ ...customOverrides, sidebar: v })}
            />
            <ColorPicker
              label="خلفية الصفحة"
              value={customOverrides.pageBg ?? "#f5f3ff"}
              onChange={(v) => setCustomOverrides({ ...customOverrides, pageBg: v })}
            />
          </div>
          {/* Live preview bar */}
          <div className="flex h-8 rounded-lg overflow-hidden border border-slate-200">
            <div className="w-16" style={{ background: customOverrides.sidebar ?? "#1e1b4b" }} />
            <div className="flex-1" style={{ background: customOverrides.pageBg ?? "#f5f3ff" }} />
            <div className="w-10" style={{ background: customOverrides.accent ?? "#7c3aed" }} />
          </div>
        </CardContent>
      </Card>

      {/* ── Font Selector ─── */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div>
            <SectionTitle>الخط</SectionTitle>
            <p className="text-xs text-slate-500 mt-0.5">اختر الخط الذي يناسب علامتك التجارية.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fontDefs.map((f) => {
              const active = fontId === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFontId(f.id)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-right transition hover:shadow-sm",
                    active ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <div>
                    <div className="text-sm font-semibold" style={{ fontFamily: f.stack }}>{f.sample}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{f.label}</div>
                  </div>
                  {active && <span className="text-xs font-bold text-indigo-600 shrink-0">✓</span>}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v)
          }}
          className="flex-1 bg-transparent text-xs font-mono outline-none"
          maxLength={7}
          dir="ltr"
        />
        <div className="h-5 w-5 shrink-0 rounded-md border border-slate-200" style={{ background: value }} />
      </div>
    </div>
  )
}

function TemplateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-700">
        <span className="text-sm font-medium">{label}</span>
        {value ? <span className="text-xs text-emerald-600">لديك قالب مخصص</span> : <span className="text-xs text-slate-400">يستخدم القالب الافتراضي</span>}
      </div>
      <textarea
        className="w-full rounded-b-lg bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-inset dark:bg-slate-950 min-h-24"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="اتركه فارغاً لاستخدام القالب الافتراضي..."
        dir="rtl"
      />
    </div>
  )
}

function WhatsAppConnectCard({
  status,
  onRestart,
  restarting,
}: {
  status: WhatsAppStatus | null
  onRestart: () => void
  restarting: boolean
}) {
  const state = status?.state ?? "DISCONNECTED"

  const badge = {
    READY:        { icon: <CheckCircle2 className="h-4 w-4" />, label: "متصل",              cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800" },
    QR:           { icon: <Loader2 className="h-4 w-4 animate-spin" />, label: "في انتظار المسح...", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800" },
    INITIALIZING: { icon: <Loader2 className="h-4 w-4 animate-spin" />, label: "جاري الاتصال...", cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800" },
    AUTH_FAILURE: { icon: <XCircle className="h-4 w-4" />,    label: "فشل المصادقة",        cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800" },
    DISCONNECTED: { icon: <WifiOff className="h-4 w-4" />,    label: "غير متصل",             cls: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700" },
    ERROR:        { icon: <XCircle className="h-4 w-4" />,    label: "خطأ",                  cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800" },
  }[state] ?? { icon: <WifiOff className="h-4 w-4" />, label: "غير متصل", cls: "bg-slate-50 text-slate-600 border-slate-200" }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <SectionTitle>ربط الواتساب</SectionTitle>
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${badge.cls}`}>
            {badge.icon}
            {badge.label}
          </span>
        </div>

        {state === "READY" && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            ✓ الواتساب متصل ويعمل. الرسائل التلقائية والملخص اليومي جاهزين.
          </p>
        )}

        {state === "QR" && status?.qrDataUrl && (
          <div className="flex flex-col items-center gap-3 py-2">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              افتح واتساب على هاتفك ← <strong>الأجهزة المرتبطة</strong> ← <strong>ربط جهاز</strong> ← امسح الباركود
            </p>
            <img
              src={status.qrDataUrl}
              alt="WhatsApp QR Code"
              className="h-56 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow dark:border-slate-700"
            />
            <p className="text-xs text-slate-400">يتحدث تلقائياً كل 3 ثواني</p>
          </div>
        )}

        {(state === "INITIALIZING") && (
          <p className="text-sm text-slate-500">جاري تهيئة الواتساب، انتظر لحظة...</p>
        )}

        {(state === "DISCONNECTED" || state === "AUTH_FAILURE" || state === "ERROR") && !status?.initialized && (
          <p className="text-sm text-slate-500">
            الواتساب غير مفعّل على السيرفر. تأكد من ضبط <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">ENABLE_WHATSAPP=true</code> في بيئة Railway.
          </p>
        )}

        {status?.error && state !== "READY" && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950 dark:text-red-400">
            {status.error}
          </p>
        )}

        {status?.provider === "web" && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            WhatsApp Web QR on cloud hosting can fail or expire. For reliable automatic messages, configure WhatsApp Cloud API.
          </p>
        )}

        <Button
          variant="outline"
          onClick={onRestart}
          disabled={restarting || state === "INITIALIZING"}
        >
          <RefreshCw className={`h-4 w-4 ${restarting ? "animate-spin" : ""}`} />
          {restarting ? "جاري إعادة التشغيل..." : "إعادة ربط الواتساب"}
        </Button>
      </CardContent>
    </Card>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className="flex h-11 items-center justify-between rounded-lg border px-4 text-sm transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span className={`h-6 w-11 rounded-full p-0.5 transition-colors ${checked ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}>
        <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "-translate-x-5" : ""}`} />
      </span>
    </button>
  )
}
