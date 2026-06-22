import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createLicensedClient, deleteLicensedClient, deletePayment,
  getLicensedClients, getLicenseStatus, getPayments, getRevenueSummary,
  renewLicense, revokeLicensedClient, updateLicensedClient,
  type LicensedClient, type RevenueSummary,
} from "../api/endpoints"
import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle, ChevronDown, ChevronUp,
  Clock, Copy, DollarSign, ExternalLink, Globe, KeyRound, Link2,
  MessageCircle, Plus, RefreshCw, Rocket, Server, ShieldAlert,
  Trash2, TrendingUp, Users, XCircle,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

// ── constants ─────────────────────────────────────────────────────────────────
const GITHUB_REPO = "https://github.com/mahdiawdcomp-cmd/makhzouni"

function railwayDeployUrl(licenseKey: string, clientName: string) {
  const p = new URLSearchParams({
    template: GITHUB_REPO,
    envs: "LICENSE_KEY,JWT_SECRET,DATABASE_URL,NODE_ENV,PORT,ALLOWED_ORIGINS",
    LICENSE_KEY: licenseKey,
    LICENSE_KEY_desc: `License Key — ${clientName}`,
    NODE_ENV: "production", PORT: "5000",
    JWT_SECRET_desc: "256-bit random secret",
    DATABASE_URL_desc: "PostgreSQL URL from Railway database",
    ALLOWED_ORIGINS_desc: "Vercel frontend URL",
  })
  return `https://railway.app/new/template?${p}`
}

function vercelDeployUrl(slug: string) {
  const p = new URLSearchParams({
    "repository-url": GITHUB_REPO,
    "project-name": `makhzouni-${slug}`,
    "root-directory": "inventory-web",
    env: "VITE_API_URL",
    envDescription: "Backend API URL — https://xxx.up.railway.app/api",
  })
  return `https://vercel.com/new/clone?${p}`
}

function buildWaMsg(c: LicensedClient) {
  return `🎉 أهلاً ${c.name}،\n\nتم إعداد نظام مخزوني الخاص بكم بنجاح.\n\n🌐 رابط النظام: ${c.frontendUrl ?? "قريباً"}\n🔑 ينتهي الترخيص: ${c.expiresAt?.slice(0, 10)}\n\n📌 بيانات الدخول الافتراضية:\n   المستخدم: admin\n   كلمة المرور: admin123\n\n⚠️ يُرجى تغيير كلمة المرور فور أول تسجيل دخول.\n\nللدعم الفني: تواصل معنا 🤝`.trim()
}

function buildRenewalMsg(c: { name: string; expiresAt: string; daysLeft: number }) {
  const days = c.daysLeft
  const verb = days > 0 ? `سينتهي خلال ${days} يوم` : "قد انتهى"
  return `مرحباً ${c.name}،\n\nترخيص نظام مخزوني الخاص بكم ${verb} (${c.expiresAt.slice(0, 10)}).\n\nللتجديد وضمان استمرارية الخدمة، يُرجى التواصل معنا في أقرب وقت. 🙏`.trim()
}

function slugify(s: string) {
  return s.replace(/\s+/g, "-").replace(/[^\w-]/g, "").toLowerCase().slice(0, 30)
}

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 0 }) }

// ── shared helpers ────────────────────────────────────────────────────────────
function statusBadge(status: LicensedClient["status"]) {
  const m: Record<string, string> = {
    valid:    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    expiring: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    expired:  "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
    revoked:  "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  }
  const labels: Record<string, string> = { valid: "ساري", expiring: "ينتهي قريباً", expired: "منتهي", revoked: "ملغي" }
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${m[status ?? "valid"] ?? m.valid}`}>{labels[status ?? "valid"]}</span>
}

function SIcon({ s }: { s: LicensedClient["status"] }) {
  if (s === "valid")    return <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
  if (s === "expiring") return <Clock       className="w-5 h-5 text-amber-500 shrink-0" />
  if (s === "revoked")  return <XCircle     className="w-5 h-5 text-slate-400 shrink-0" />
  return                       <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
}

function Field({ label, value, onChange, placeholder, type = "text", min, max }: {
  label: string; value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string; type?: string; min?: string; max?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--theme-text-muted)] mb-1">{label}</label>
      <input type={type} value={value} onChange={onChange} placeholder={placeholder} min={min} max={max}
        className="w-full px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)] transition" />
    </div>
  )
}

// ── Wizard ────────────────────────────────────────────────────────────────────
function NewClientWizard({ onClose, onDone }: { onClose: () => void; onDone: (c: LicensedClient) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [form, setForm] = useState({ name: "", months: "12", notes: "", contactPhone: "", contactEmail: "" })
  const [created, setCreated] = useState<LicensedClient | null>(null)
  const [urls, setUrls] = useState({ backendUrl: "", frontendUrl: "" })
  const [copied, setCopied] = useState<string | null>(null)
  const qc = useQueryClient()

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const createMut = useMutation({
    mutationFn: createLicensedClient,
    onSuccess: c => { setCreated(c); setStep(2); qc.invalidateQueries({ queryKey: ["licensed-clients"] }) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...r }: { id: string; backendUrl?: string; frontendUrl?: string }) =>
      updateLicensedClient(id, r),
    onSuccess: c => { qc.invalidateQueries({ queryKey: ["licensed-clients"] }); onDone(c) },
  })

  function copy(k: string, t: string) { navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(null), 2000) }
  const expiry = new Date(Date.now() + Number(form.months) * 30 * 86_400_000).toLocaleDateString("ar-IQ")

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.94 }} animate={{ scale: 1 }} exit={{ scale: 0.94 }}
        className="w-full max-w-lg bg-[var(--theme-card)] rounded-2xl shadow-2xl overflow-hidden">

        {/* Steps */}
        <div className="flex border-b border-[var(--theme-border)]">
          {[{ n: 1, l: "البيانات" }, { n: 2, l: "النشر" }, { n: 3, l: "الروابط" }].map(({ n, l }) => (
            <div key={n} className={`flex-1 py-3 text-center text-xs font-semibold border-b-2 transition-colors ${
              step === n ? "border-[var(--theme-accent)] text-[var(--theme-accent)]"
                : step > n ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-[var(--theme-text-muted)]"}`}>
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-1 ${
                step > n ? "bg-emerald-500 text-white" : step === n ? "bg-[var(--theme-accent)] text-white" : "bg-[var(--theme-border)] text-[var(--theme-text-muted)]"
              }`}>{step > n ? "✓" : n}</span>{l}
            </div>
          ))}
        </div>

        <div className="p-6">
          {step === 1 && (
            <div className="space-y-3">
              <h2 className="text-base font-bold text-[var(--theme-text)] mb-4">معلومات العميل الجديد</h2>
              <Field label="اسم العميل / الشركة *" value={form.name} onChange={f("name")} placeholder="شركة الأمانة للتجارة" />
              <Field label={`مدة الترخيص (شهر) — ينتهي: ${expiry}`} value={form.months} onChange={f("months")} type="number" min="1" max="240" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="هاتف التواصل" value={form.contactPhone} onChange={f("contactPhone")} placeholder="07xxxxxxxxx" />
                <Field label="البريد الإلكتروني" value={form.contactEmail} onChange={f("contactEmail")} placeholder="info@co.com" />
              </div>
              <Field label="ملاحظات" value={form.notes} onChange={f("notes")} placeholder="بغداد — تجزئة" />
              {createMut.error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{(createMut.error as Error).message}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => createMut.mutate({ name: form.name.trim(), months: Number(form.months), notes: form.notes, contactPhone: form.contactPhone, contactEmail: form.contactEmail })}
                  disabled={!form.name.trim() || createMut.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {createMut.isPending ? "جاري الإنشاء..." : <><KeyRound className="w-4 h-4" />إنشاء الترخيص</>}
                </button>
                <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[var(--theme-border)] text-sm text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition">إلغاء</button>
              </div>
            </div>
          )}

          {step === 2 && created && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-[var(--theme-text)]">انشر النظام لـ {created.name}</h2>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" />مفتاح الترخيص — مُضمَّن تلقائياً</span>
                  <button onClick={() => copy("key", `LICENSE_KEY=${created.licenseKey}`)} className={`text-xs px-2 py-0.5 rounded-lg flex items-center gap-1 transition ${copied === "key" ? "text-emerald-600" : "text-slate-500 hover:text-slate-700"}`}>
                    <Copy className="w-3 h-3" />{copied === "key" ? "تم!" : "نسخ"}
                  </button>
                </div>
                <code className="text-[10px] text-emerald-800 dark:text-emerald-300 break-all font-mono">{created.licenseKey.slice(0, 60)}…</code>
              </div>
              <a href={railwayDeployUrl(created.licenseKey, created.name)} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#0B0D0E] hover:bg-[#1a1d1f] text-white text-sm font-semibold transition border border-white/10">
                <Rocket className="w-4 h-4" />نشر Backend على Railway<ExternalLink className="w-3.5 h-3.5 opacity-60" />
              </a>
              <a href={vercelDeployUrl(slugify(created.name))} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#000] hover:bg-[#111] text-white text-sm font-semibold transition border border-white/10">
                <Globe className="w-4 h-4" />نشر Frontend على Vercel<ExternalLink className="w-3.5 h-3.5 opacity-60" />
              </a>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <p className="font-semibold">📌 بعد النشر:</p>
                <p>1. Railway: أضف PostgreSQL + <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">JWT_SECRET</code></p>
                <p>2. Vercel: أضف <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">VITE_API_URL=https://&lt;railway-url&gt;/api</code></p>
                <p>3. Railway: أضف <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">ALLOWED_ORIGINS=https://&lt;vercel-url&gt;</code></p>
              </div>
              <button onClick={() => setStep(3)} className="w-full py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 transition flex items-center justify-center gap-2">
                تم النشر — سجّل الروابط <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 3 && created && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-[var(--theme-text)]">روابط {created.name}</h2>
              <Field label="رابط Backend (Railway)" value={urls.backendUrl} onChange={e => setUrls(u => ({ ...u, backendUrl: e.target.value }))} placeholder="https://xxx.up.railway.app" />
              <Field label="رابط Frontend (Vercel)" value={urls.frontendUrl} onChange={e => setUrls(u => ({ ...u, frontendUrl: e.target.value }))} placeholder="https://makhzouni-xxx.vercel.app" />
              <div className="bg-[var(--theme-bg)] rounded-xl border border-[var(--theme-border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[var(--theme-text)] flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5 text-green-500" />رسالة تسليم واتساب</span>
                  <button onClick={() => copy("wa", buildWaMsg({ ...created, backendUrl: urls.backendUrl || null, frontendUrl: urls.frontendUrl || null }))}
                    className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded-lg transition ${copied === "wa" ? "text-green-600" : "text-slate-500 hover:text-slate-700"}`}>
                    <Copy className="w-3 h-3" />{copied === "wa" ? "تم!" : "نسخ"}
                  </button>
                </div>
                <pre className="text-[10px] text-[var(--theme-text-muted)] whitespace-pre-wrap leading-relaxed font-mono">
                  {buildWaMsg({ ...created, backendUrl: urls.backendUrl || null, frontendUrl: urls.frontendUrl || null })}
                </pre>
              </div>
              <div className="flex gap-3">
                <button onClick={() => updateMut.mutate({ id: created.id, ...urls })} disabled={updateMut.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {updateMut.isPending ? "جاري الحفظ..." : <><CheckCircle className="w-4 h-4" />حفظ وإغلاق</>}
                </button>
                <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[var(--theme-border)] text-sm text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition">تخطي</button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Renew Modal ───────────────────────────────────────────────────────────────
function RenewModal({ client, onClose }: { client: LicensedClient; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ months: "12", amount: "", currency: "USD", method: "cash", notes: "" })
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const renewMut = useMutation({
    mutationFn: () => renewLicense(client.id, {
      months: Number(form.months), amount: Number(form.amount),
      currency: form.currency, method: form.method, notes: form.notes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["licensed-clients"] })
      qc.invalidateQueries({ queryKey: ["revenue"] })
      qc.invalidateQueries({ queryKey: ["payments"] })
      onClose()
    },
  })

  const newExpiry = new Date(
    (client.expiresAt && new Date(client.expiresAt) > new Date() ? new Date(client.expiresAt) : new Date()).getTime()
    + Number(form.months) * 30 * 86_400_000
  ).toLocaleDateString("ar-IQ")

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.94 }} animate={{ scale: 1 }} exit={{ scale: 0.94 }}
        className="w-full max-w-md bg-[var(--theme-card)] rounded-2xl shadow-2xl p-6">
        <h2 className="text-base font-bold text-[var(--theme-text)] mb-1 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-[var(--theme-accent)]" />تجديد ترخيص {client.name}
        </h2>
        <p className="text-xs text-[var(--theme-text-muted)] mb-4">الانتهاء الحالي: {client.expiresAt?.slice(0, 10)}</p>
        <div className="space-y-3">
          <Field label={`المدة (شهر) — الانتهاء الجديد: ${newExpiry}`} value={form.months} onChange={f("months")} type="number" min="1" max="240" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="المبلغ المدفوع *" value={form.amount} onChange={f("amount")} type="number" min="0" placeholder="50" />
            <Field label="العملة" value={form.currency} onChange={f("currency")} placeholder="USD" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--theme-text-muted)] mb-1">طريقة الدفع</label>
            <select value={form.method} onChange={f("method")}
              className="w-full px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]">
              <option value="cash">نقداً</option>
              <option value="transfer">تحويل بنكي</option>
              <option value="card">بطاقة</option>
              <option value="other">أخرى</option>
            </select>
          </div>
          <Field label="ملاحظات" value={form.notes} onChange={f("notes")} placeholder="اختياري" />
        </div>
        {renewMut.error && <p className="mt-2 text-xs text-red-500">{(renewMut.error as Error).message}</p>}
        <div className="flex gap-3 mt-5">
          <button onClick={() => renewMut.mutate()} disabled={!form.amount || renewMut.isPending}
            className="flex-1 py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center gap-2">
            {renewMut.isPending ? "جاري التجديد..." : <><RefreshCw className="w-4 h-4" />تجديد وتسجيل الدفعة</>}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[var(--theme-border)] text-sm text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition">إلغاء</button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Client Card ───────────────────────────────────────────────────────────────
function ClientCard({ client, onRenew }: { client: LicensedClient; onRenew: () => void }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [editUrls, setEditUrls] = useState(false)
  const [urls, setUrls] = useState({ backendUrl: client.backendUrl ?? "", frontendUrl: client.frontendUrl ?? "" })
  const [copied, setCopied] = useState<string | null>(null)

  function copy(k: string, t: string) { navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(null), 2500) }

  const revokeMut = useMutation({ mutationFn: revokeLicensedClient, onSuccess: () => qc.invalidateQueries({ queryKey: ["licensed-clients"] }) })
  const deleteMut = useMutation({ mutationFn: deleteLicensedClient, onSuccess: () => qc.invalidateQueries({ queryKey: ["licensed-clients"] }) })
  const updateMut = useMutation({
    mutationFn: (p: { id: string; backendUrl?: string; frontendUrl?: string }) => updateLicensedClient(p.id, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["licensed-clients"] }); setEditUrls(false) },
  })

  const waMsg  = buildWaMsg(client)
  const waLink = client.contactPhone ? `https://wa.me/${client.contactPhone.replace(/\D/g, "")}?text=${encodeURIComponent(waMsg)}` : null

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-[var(--theme-card)] rounded-2xl border border-[var(--theme-border)] overflow-hidden">
      <div className="p-4 flex items-start gap-3">
        <SIcon s={client.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[var(--theme-text)]">{client.name}</span>
            {statusBadge(client.status)}
            {client.daysLeft !== undefined && !client.isRevoked && client.daysLeft > 0 && (
              <span className="text-xs text-[var(--theme-text-muted)]">{client.daysLeft} يوم</span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 mt-0.5">
            {client.frontendUrl
              ? <a href={client.frontendUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--theme-accent)] flex items-center gap-1 hover:underline"><Globe className="w-3 h-3" />فتح النظام</a>
              : <span className="text-xs text-[var(--theme-text-muted)] italic flex items-center gap-1"><Globe className="w-3 h-3" />لم يُنشر</span>
            }
            {client.contactPhone && <span className="text-xs text-[var(--theme-text-muted)]">{client.contactPhone}</span>}
            <span className="text-xs text-[var(--theme-text-muted)]">ينتهي: {client.expiresAt?.slice(0, 10)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onRenew} className="p-1.5 rounded-lg text-[var(--theme-accent)] hover:bg-[var(--theme-bg)] transition" title="تجديد الترخيص">
            <RefreshCw className="w-4 h-4" />
          </button>
          {waLink
            ? <a href={waLink} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition" title="واتساب"><MessageCircle className="w-4 h-4" /></a>
            : <button onClick={() => copy("wa", waMsg)} className={`p-1.5 rounded-lg transition ${copied === "wa" ? "text-green-500" : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]"}`} title="نسخ رسالة"><MessageCircle className="w-4 h-4" /></button>
          }
          <button onClick={() => copy("key", `LICENSE_KEY=${client.licenseKey}`)} className={`p-1.5 rounded-lg transition ${copied === "key" ? "text-emerald-500" : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]"}`} title="نسخ المفتاح"><KeyRound className="w-4 h-4" /></button>
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {(copied === "key" || copied === "wa") && (
        <div className={`px-4 pb-2 text-xs ${copied === "key" ? "text-emerald-500" : "text-green-500"}`}>
          {copied === "key" ? "✓ تم نسخ LICENSE_KEY — الصق في Railway Variables" : "✓ تم نسخ رسالة التسليم"}
        </div>
      )}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 border-t border-[var(--theme-border)] pt-3 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[var(--theme-text)]">روابط النشر</span>
                  <button onClick={() => setEditUrls(e => !e)} className="text-xs text-[var(--theme-accent)] hover:underline flex items-center gap-1"><Link2 className="w-3 h-3" />{editUrls ? "إلغاء" : "تعديل"}</button>
                </div>
                {editUrls ? (
                  <div className="space-y-2">
                    <input value={urls.backendUrl} onChange={e => setUrls(u => ({ ...u, backendUrl: e.target.value }))} placeholder="https://xxx.up.railway.app"
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]" />
                    <input value={urls.frontendUrl} onChange={e => setUrls(u => ({ ...u, frontendUrl: e.target.value }))} placeholder="https://makhzouni-xxx.vercel.app"
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]" />
                    <button onClick={() => updateMut.mutate({ id: client.id, ...urls })} disabled={updateMut.isPending}
                      className="px-3 py-1.5 text-xs rounded-lg bg-[var(--theme-accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50 transition">
                      {updateMut.isPending ? "..." : "حفظ"}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {[{ icon: <Server className="w-3 h-3" />, l: "Backend", url: client.backendUrl },
                      { icon: <Globe  className="w-3 h-3" />, l: "Frontend", url: client.frontendUrl }].map(({ icon, l, url }) => (
                      url ? (
                        <a key={l} href={url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--theme-bg)] border border-[var(--theme-border)] text-xs text-[var(--theme-accent)] hover:underline truncate">
                          {icon}<span className="truncate">{l}</span><ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
                        </a>
                      ) : (
                        <div key={l} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--theme-bg)] border border-dashed border-[var(--theme-border)] text-xs text-[var(--theme-text-muted)] truncate">
                          {icon}<span className="truncate">{l} — لم يُضَف</span>
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
              {!client.backendUrl && (
                <a href={railwayDeployUrl(client.licenseKey, client.name)} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-[#0B0D0E] hover:bg-[#1a1d1f] text-white text-xs font-semibold transition">
                  <Rocket className="w-3.5 h-3.5" />نشر على Railway<ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              )}
              {client.notes && <p className="text-xs text-[var(--theme-text-muted)] italic">{client.notes}</p>}
              <div className="flex gap-2 pt-1">
                {!client.isRevoked && (
                  <button onClick={() => { if (confirm(`إلغاء ترخيص "${client.name}"?`)) revokeMut.mutate(client.id) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-amber-600 border border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition">
                    <XCircle className="w-3.5 h-3.5" />إلغاء الترخيص
                  </button>
                )}
                <button onClick={() => { if (confirm(`حذف "${client.name}" نهائياً؟`)) deleteMut.mutate(client.id) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
                  <Trash2 className="w-3.5 h-3.5" />حذف
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Revenue Tab ───────────────────────────────────────────────────────────────
function RevenueTab() {
  const { data: rev, isLoading } = useQuery<RevenueSummary>({ queryKey: ["revenue"], queryFn: getRevenueSummary })
  const { data: payments = [] }  = useQuery({ queryKey: ["payments"], queryFn: () => getPayments() })
  const qc = useQueryClient()
  const deleteMut = useMutation({
    mutationFn: deletePayment,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payments"] }); qc.invalidateQueries({ queryKey: ["revenue"] }) },
  })

  if (isLoading) return <div className="text-center py-20 text-[var(--theme-text-muted)] text-sm">جاري التحميل...</div>
  if (!rev) return null

  const maxBar = Math.max(...rev.monthlyChart.map(m => m.amount), 1)

  const methodLabel: Record<string, string> = { cash: "نقداً", transfer: "تحويل", card: "بطاقة", other: "أخرى" }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "هذا الشهر",    value: rev.totalThisMonth, icon: <TrendingUp className="w-5 h-5" />, color: "text-emerald-500" },
          { label: "هذا العام",    value: rev.totalThisYear,  icon: <BarChart3  className="w-5 h-5" />, color: "text-blue-500" },
          { label: "الإجمالي الكلي", value: rev.totalAllTime, icon: <DollarSign className="w-5 h-5" />, color: "text-[var(--theme-accent)]" },
        ].map(s => (
          <div key={s.label} className="bg-[var(--theme-card)] rounded-2xl border border-[var(--theme-border)] p-4">
            <div className={`mb-2 ${s.color}`}>{s.icon}</div>
            <div className={`text-xl font-bold ${s.color}`}>{fmt(s.value)} {rev.currency}</div>
            <div className="text-xs text-[var(--theme-text-muted)] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Monthly chart */}
      <div className="bg-[var(--theme-card)] rounded-2xl border border-[var(--theme-border)] p-4">
        <h3 className="text-sm font-semibold text-[var(--theme-text)] mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[var(--theme-accent)]" />الإيرادات الشهرية — آخر 12 شهر
        </h3>
        <div className="flex items-end gap-1 h-28">
          {rev.monthlyChart.map(({ month, amount }) => (
            <div key={month} className="flex-1 flex flex-col items-center gap-1 group">
              <div className="relative w-full">
                <div className="w-full rounded-t-md bg-[var(--theme-accent)] opacity-80 hover:opacity-100 transition-all"
                  style={{ height: `${Math.max((amount / maxBar) * 96, amount > 0 ? 4 : 0)}px` }} />
              </div>
              {amount > 0 && (
                <span className="text-[9px] text-[var(--theme-text-muted)] hidden group-hover:block absolute -mt-5 bg-[var(--theme-card)] px-1 rounded shadow text-xs">
                  {fmt(amount)}
                </span>
              )}
              <span className="text-[9px] text-[var(--theme-text-muted)]">{month.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Payments list */}
      <div className="bg-[var(--theme-card)] rounded-2xl border border-[var(--theme-border)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--theme-border)] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--theme-text)] flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-[var(--theme-accent)]" />سجل المدفوعات ({payments.length})
          </h3>
        </div>
        {payments.length === 0 ? (
          <div className="text-center py-10 text-[var(--theme-text-muted)] text-sm">لا توجد مدفوعات بعد</div>
        ) : (
          <div className="divide-y divide-[var(--theme-border)]">
            {payments.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <DollarSign className="w-4 h-4 text-emerald-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--theme-text)]">{p.clientName}</p>
                  <p className="text-xs text-[var(--theme-text-muted)]">
                    {p.paidAt.slice(0, 10)} · {methodLabel[p.method ?? ""] ?? p.method ?? "—"}
                    {p.notes && ` · ${p.notes}`}
                  </p>
                </div>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{fmt(p.amount)} {p.currency}</span>
                <button onClick={() => { if (confirm("حذف هذه الدفعة؟")) deleteMut.mutate(p.id) }}
                  className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Renewals Tab ──────────────────────────────────────────────────────────────
function RenewalsTab({ clients, onRenew }: { clients: LicensedClient[]; onRenew: (c: LicensedClient) => void }) {
  const { data: rev } = useQuery<RevenueSummary>({ queryKey: ["revenue"], queryFn: getRevenueSummary })
  const [copied, setCopied] = useState<string | null>(null)
  function copy(k: string, t: string) { navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(null), 2500) }

  const dueSoon = rev?.renewalsDueSoon ?? []
  const expiredClients = clients.filter(c => c.status === "expired" && !c.isRevoked)

  return (
    <div className="space-y-5">
      {dueSoon.length === 0 && expiredClients.length === 0 ? (
        <div className="text-center py-24 text-[var(--theme-text-muted)]">
          <CheckCircle className="w-14 h-14 mx-auto mb-4 opacity-20" />
          <p className="text-base font-medium">لا تجديدات مطلوبة</p>
          <p className="text-sm mt-1">جميع التراخيص سارية وليس هناك انتهاءات خلال 45 يوم</p>
        </div>
      ) : (
        <>
          {dueSoon.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--theme-text)] mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />ينتهي خلال 45 يوم ({dueSoon.length})
              </h3>
              <div className="space-y-2">
                {dueSoon.map(c => {
                  const client = clients.find(cl => cl.id === c.id)
                  const msg = buildRenewalMsg(c)
                  const waLink = c.contactPhone ? `https://wa.me/${c.contactPhone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}` : null
                  return (
                    <div key={c.id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                      c.daysLeft <= 0 ? "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800"
                        : c.daysLeft <= 7 ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800"
                        : "bg-[var(--theme-card)] border-[var(--theme-border)]"}`}>
                      <Clock className={`w-5 h-5 shrink-0 ${c.daysLeft <= 0 ? "text-red-500" : c.daysLeft <= 7 ? "text-amber-500" : "text-[var(--theme-text-muted)]"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[var(--theme-text)]">{c.name}</p>
                        <p className="text-xs text-[var(--theme-text-muted)]">
                          {c.daysLeft <= 0 ? `انتهى منذ ${Math.abs(c.daysLeft)} يوم` : `ينتهي خلال ${c.daysLeft} يوم — ${c.expiresAt.slice(0, 10)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {waLink
                          ? <a href={waLink} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition" title="إرسال تذكير واتساب"><MessageCircle className="w-4 h-4" /></a>
                          : <button onClick={() => copy(c.id + "wa", msg)} className={`p-1.5 rounded-lg transition ${copied === c.id + "wa" ? "text-green-500" : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]"}`} title="نسخ رسالة التذكير"><MessageCircle className="w-4 h-4" /></button>
                        }
                        {client && (
                          <button onClick={() => onRenew(client)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-[var(--theme-accent)] text-white font-semibold hover:opacity-90 transition">
                            <RefreshCw className="w-3 h-3" />تجديد
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function SuperAdminPage() {
  const { data: clients = [], isLoading } = useQuery({ queryKey: ["licensed-clients"], queryFn: getLicensedClients })
  const { data: ownLicense } = useQuery({ queryKey: ["license-status"], queryFn: getLicenseStatus })

  const [tab, setTab]             = useState<"clients" | "revenue" | "renewals">("clients")
  const [showWizard, setShowWizard] = useState(false)
  const [renewTarget, setRenewTarget] = useState<LicensedClient | null>(null)
  const [lastCreated, setLastCreated] = useState<LicensedClient | null>(null)

  const activeCount   = clients.filter(c => c.status === "valid" || c.status === "expiring").length
  const deployedCount = clients.filter(c => !!c.frontendUrl).length
  const dueSoonCount  = clients.filter(c => !c.isRevoked && (c.daysLeft ?? 999) <= 45).length

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] p-4 md:p-8" dir="rtl">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--theme-text)] flex items-center gap-2">
              <Rocket className="w-6 h-6 text-[var(--theme-accent)]" />لوحة المطوّر — إدارة الأنظمة
            </h1>
            <p className="text-sm text-[var(--theme-text-muted)] mt-1">
              {activeCount} ترخيص نشط · {deployedCount} منشور · {clients.length} إجمالي
              {dueSoonCount > 0 && <span className="mr-2 text-amber-500 font-medium">· {dueSoonCount} تجديد قريب</span>}
            </p>
          </div>
          {tab === "clients" && (
            <button onClick={() => setShowWizard(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 transition shadow-lg shadow-[var(--theme-accent)]/20">
              <Plus className="w-4 h-4" />عميل جديد
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-[var(--theme-card)] rounded-xl p-1 border border-[var(--theme-border)] mb-5">
          {([
            { k: "clients",  l: "العملاء",   icon: <Users     className="w-3.5 h-3.5" /> },
            { k: "revenue",  l: "الإيرادات", icon: <BarChart3 className="w-3.5 h-3.5" /> },
            { k: "renewals", l: "التجديدات", icon: <RefreshCw className="w-3.5 h-3.5" />, badge: dueSoonCount },
          ] as { k: typeof tab; l: string; icon: React.ReactNode; badge?: number }[]).map(({ k, l, icon, badge }) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === k ? "bg-[var(--theme-accent)] text-white shadow-sm" : "text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"}`}>
              {icon}{l}
              {badge != null && badge > 0 && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tab === k ? "bg-white/20 text-white" : "bg-amber-500 text-white"}`}>{badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Own license bar */}
        {ownLicense && ownLicense.status !== "missing" && (
          <div className="mb-4 p-3 rounded-xl bg-[var(--theme-card)] border border-[var(--theme-border)] flex items-center gap-3">
            <SIcon s={ownLicense.status as LicensedClient["status"]} />
            <div>
              <p className="text-sm font-medium text-[var(--theme-text)]">ترخيص هذا النظام — {ownLicense.clientName}</p>
              <p className="text-xs text-[var(--theme-text-muted)]">{ownLicense.expiresAt?.slice(0, 10)} · {statusBadge(ownLicense.status as LicensedClient["status"])}</p>
            </div>
          </div>
        )}

        {/* Success banner */}
        <AnimatePresence>
          {lastCreated && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
              <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">✓ تم إنشاء نظام {lastCreated.name} بنجاح</span>
              <button onClick={() => setLastCreated(null)} className="text-emerald-600 text-xs">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tab content */}
        {tab === "clients" && (
          isLoading ? (
            <div className="text-center py-20 text-[var(--theme-text-muted)] text-sm">جاري التحميل...</div>
          ) : clients.length === 0 ? (
            <div className="text-center py-24 text-[var(--theme-text-muted)]">
              <Rocket className="w-14 h-14 mx-auto mb-4 opacity-20" />
              <p className="text-base font-medium">لا يوجد عملاء بعد</p>
              <p className="text-sm mt-1">اضغط "عميل جديد" لإنشاء أول نظام</p>
            </div>
          ) : (
            <div className="space-y-3">
              {clients.map(c => <ClientCard key={c.id} client={c} onRenew={() => setRenewTarget(c)} />)}
            </div>
          )
        )}

        {tab === "revenue"  && <RevenueTab />}
        {tab === "renewals" && <RenewalsTab clients={clients} onRenew={c => setRenewTarget(c)} />}

        {/* Modals */}
        <AnimatePresence>
          {showWizard && <NewClientWizard onClose={() => setShowWizard(false)} onDone={c => { setLastCreated(c); setShowWizard(false) }} />}
          {renewTarget && <RenewModal client={renewTarget} onClose={() => setRenewTarget(null)} />}
        </AnimatePresence>
      </div>
    </div>
  )
}
