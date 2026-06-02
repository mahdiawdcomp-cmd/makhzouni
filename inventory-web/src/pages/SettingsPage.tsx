import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BellRing,
  Building2,
  Download,
  FileJson,
  ImagePlus,
  MessageCircle,
  Palette,
  Save,
  Upload,
} from "lucide-react"
import {
  getCustomers,
  getMessageTemplates,
  getProducts,
  getSettings,
  updateMessageTemplate,
  updateSettings,
} from "../api/endpoints"
import type { AppSettings, MessageTemplate } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { useTheme } from "../theme/ThemeProvider"
import { cn } from "../utils/cn"

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

type SettingsTab = "store" | "theme" | "whatsapp" | "alerts" | "backup"

const TABS: { id: SettingsTab; label: string; icon: typeof Building2 }[] = [
  { id: "store",    label: "المتجر",        icon: Building2 },
  { id: "theme",    label: "المظهر",        icon: Palette },
  { id: "whatsapp", label: "واتساب",        icon: MessageCircle },
  { id: "alerts",   label: "التنبيهات",     icon: BellRing },
  { id: "backup",   label: "النسخ الاحتياطي", icon: Download },
]

export function SettingsPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const templatesQuery = useQuery({ queryKey: ["message-templates"], queryFn: getMessageTemplates })
  const productsQuery = useQuery({ queryKey: ["products", "backup"], queryFn: () => getProducts() })
  const customersQuery = useQuery({ queryKey: ["customers", "backup"], queryFn: () => getCustomers() })
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings)
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [importMsg, setImportMsg] = useState("")
  const [activeTab, setActiveTab] = useState<SettingsTab>("store")
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (settingsQuery.data) setSettings({ ...fallbackSettings, ...settingsQuery.data }) }, [settingsQuery.data])
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
      {activeTab === "theme" && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <SectionTitle>ثيم التطبيق</SectionTitle>
            <p className="text-xs text-slate-500">اختر الثيم وسيتغير لون الشريط الجانبي، الأزرار، والبادج تلقائياً.</p>
            <ThemeChooser />
          </CardContent>
        </Card>
      )}

      {/* ── WHATSAPP ───────────────────────────────────────── */}
      {activeTab === "whatsapp" && (
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
      )}

      {/* ── ALERTS ─────────────────────────────────────────── */}
      {activeTab === "alerts" && (
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
      )}

      {/* ── BACKUP ─────────────────────────────────────────── */}
      {activeTab === "backup" && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <SectionTitle>النسخ الاحتياطي والاستيراد</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button onClick={() => downloadText("inventory-backup.json", JSON.stringify(backup, null, 2), "application/json")}>
                <FileJson className="h-4 w-4" /> تصدير كامل JSON
              </Button>
              <Button variant="outline" onClick={() => downloadText("products.csv", toCsv(productsQuery.data ?? []), "text/csv;charset=utf-8")}>
                <Download className="h-4 w-4" /> تصدير المنتجات CSV
              </Button>
              <Button variant="outline" onClick={() => downloadText("customers.csv", toCsv(customersQuery.data ?? []), "text/csv;charset=utf-8")}>
                <Download className="h-4 w-4" /> تصدير الزبائن CSV
              </Button>
              <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-4 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800">
                <Upload className="h-4 w-4" /> استيراد من ملف
                <input className="hidden" type="file" accept="application/json" onChange={(e) => importBackup(e.target.files?.[0])} />
              </label>
            </div>
            {importMsg ? (
              <div className={`rounded-md px-3 py-2 text-sm ${importMsg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{importMsg}</div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

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

function ThemeChooser() {
  const { themeId, setThemeId, presets } = useTheme()
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {presets.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setThemeId(t.id)}
          className={cn(
            "group overflow-hidden rounded-xl border text-right transition hover:shadow-md",
            themeId === t.id
              ? "border-2 ring-2"
              : "border-slate-200 dark:border-slate-700",
          )}
          style={themeId === t.id ? { borderColor: t.vars.accent, outlineColor: t.vars.accent } : {}}
        >
          {/* Color swatches */}
          <div className="flex h-10">
            <div className="flex-1" style={{ background: t.vars.sidebar }} />
            <div className="flex-1" style={{ background: t.vars.accent }} />
            <div className="flex-1" style={{ background: t.vars.sale }} />
            <div className="flex-1" style={{ background: t.vars.purchase }} />
            <div className="flex-1" style={{ background: t.vars.receipt }} />
          </div>
          <div className="space-y-0.5 bg-white p-3 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm">{t.label}</span>
              {themeId === t.id ? <span className="text-xs font-medium text-emerald-600">✓ مختار</span> : null}
            </div>
            <div className="text-xs text-slate-500">{t.description}</div>
          </div>
        </button>
      ))}
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
