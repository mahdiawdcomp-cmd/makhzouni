import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createLicensedClient,
  deleteLicensedClient,
  getLicensedClients,
  getLicenseStatus,
  revokeLicensedClient,
  updateLicensedClient,
  type LicensedClient,
} from "../api/endpoints"
import {
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Link2,
  MessageCircle,
  Plus,
  Rocket,
  Server,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

// ── constants ─────────────────────────────────────────────────────────────────

const GITHUB_REPO = "https://github.com/mahdiawdcomp-cmd/makhzouni"

function railwayDeployUrl(licenseKey: string, clientName: string) {
  const params = new URLSearchParams({
    template: GITHUB_REPO,
    envs: "LICENSE_KEY,JWT_SECRET,DATABASE_URL,NODE_ENV,PORT,ALLOWED_ORIGINS",
    LICENSE_KEY: licenseKey,
    LICENSE_KEY_desc: `License Key — ${clientName}`,
    NODE_ENV: "production",
    NODE_ENV_desc: "Production environment",
    PORT: "5000",
    PORT_desc: "Server port",
    JWT_SECRET_desc: "256-bit random secret — generate with: openssl rand -hex 32",
    DATABASE_URL_desc: "PostgreSQL connection string from Railway database service",
    ALLOWED_ORIGINS_desc: "Vercel frontend URL (comma-separated)",
  })
  return `https://railway.app/new/template?${params.toString()}`
}

function vercelDeployUrl(clientSlug: string) {
  const params = new URLSearchParams({
    "repository-url": GITHUB_REPO,
    "project-name": `makhzouni-${clientSlug}`,
    "root-directory": "inventory-web",
    env: "VITE_API_URL",
    envDescription: "Backend API URL — e.g. https://your-railway-url.up.railway.app/api",
  })
  return `https://vercel.com/new/clone?${params.toString()}`
}

function buildWhatsAppMsg(client: LicensedClient) {
  const frontend = client.frontendUrl ?? "⬜ لم يُحدَّد بعد"
  const backend  = client.backendUrl  ?? "⬜ لم يُحدَّد بعد"
  const expiry   = client.expiresAt?.slice(0, 10) ?? ""
  return `
🎉 أهلاً ${client.name}،

تم إعداد نظام مخزوني الخاص بكم بنجاح.

🌐 رابط النظام: ${frontend}
🔗 رابط الـ API: ${backend}
🔑 تاريخ انتهاء الترخيص: ${expiry}

📌 بيانات الدخول الافتراضية:
   المستخدم: admin
   كلمة المرور: admin123

⚠️ يُرجى تغيير كلمة المرور فور أول تسجيل دخول.

للدعم الفني: تواصل معنا في أي وقت 🤝
`.trim()
}

function slugify(name: string) {
  return name.replace(/\s+/g, "-").replace(/[^\w-]/g, "").toLowerCase().slice(0, 30)
}

// ── status helpers ────────────────────────────────────────────────────────────

function statusBadge(status: LicensedClient["status"]) {
  const map: Record<string, { label: string; cls: string }> = {
    valid:    { label: "ساري",        cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    expiring: { label: "ينتهي قريباً", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    expired:  { label: "منتهي",       cls: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" },
    revoked:  { label: "ملغي",        cls: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  }
  const s = map[status ?? "valid"] ?? map.valid
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
}

function StatusIcon({ s }: { s: LicensedClient["status"] }) {
  if (s === "valid")    return <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
  if (s === "expiring") return <Clock       className="w-5 h-5 text-amber-500 shrink-0" />
  if (s === "revoked")  return <XCircle     className="w-5 h-5 text-slate-400 shrink-0" />
  return                       <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
}

// ── wizard ────────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3

interface WizardState {
  name: string; months: number; notes: string
  contactPhone: string; contactEmail: string
}

function NewClientWizard({
  onClose, onDone,
}: { onClose: () => void; onDone: (c: LicensedClient) => void }) {
  const [step, setStep] = useState<WizardStep>(1)
  const [form, setForm] = useState<WizardState>({ name: "", months: 12, notes: "", contactPhone: "", contactEmail: "" })
  const [created, setCreated] = useState<LicensedClient | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [urls, setUrls] = useState({ backendUrl: "", frontendUrl: "" })

  const qc = useQueryClient()
  const createMutation = useMutation({
    mutationFn: createLicensedClient,
    onSuccess: (c) => { setCreated(c); setStep(2); qc.invalidateQueries({ queryKey: ["licensed-clients"] }) },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, ...rest }: { id: string; backendUrl?: string; frontendUrl?: string }) =>
      updateLicensedClient(id, rest),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["licensed-clients"] }); onDone(c) },
  })

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }

  const f = (k: keyof WizardState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: k === "months" ? Number(e.target.value) : e.target.value }))

  const expiry = new Date(Date.now() + form.months * 30 * 86_400_000).toLocaleDateString("ar-IQ")

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        className="w-full max-w-lg bg-[var(--theme-card)] rounded-2xl shadow-2xl overflow-hidden">

        {/* Steps header */}
        <div className="flex border-b border-[var(--theme-border)]">
          {([
            { n: 1, label: "بيانات العميل" },
            { n: 2, label: "النشر على Railway" },
            { n: 3, label: "تأكيد الروابط" },
          ] as { n: WizardStep; label: string }[]).map(({ n, label }) => (
            <div key={n} className={`flex-1 py-3 text-center text-xs font-semibold border-b-2 transition-colors ${
              step === n ? "border-[var(--theme-accent)] text-[var(--theme-accent)]"
                : step > n ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-[var(--theme-text-muted)]"
            }`}>
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold mr-1 ${
                step > n ? "bg-emerald-500 text-white" : step === n ? "bg-[var(--theme-accent)] text-white" : "bg-[var(--theme-border)] text-[var(--theme-text-muted)]"
              }`}>{step > n ? "✓" : n}</span>
              {label}
            </div>
          ))}
        </div>

        <div className="p-6">
          {/* ── Step 1: Client info ── */}
          {step === 1 && (
            <div className="space-y-3">
              <h2 className="text-base font-bold text-[var(--theme-text)] mb-4">معلومات العميل الجديد</h2>
              <Field label="اسم العميل / الشركة *" value={form.name} onChange={f("name")} placeholder="شركة الأمانة للتجارة" />
              <div>
                <Field label={`مدة الترخيص (شهر) — ينتهي: ${expiry}`} value={String(form.months)} onChange={f("months")} type="number" min="1" max="240" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="رقم الهاتف" value={form.contactPhone} onChange={f("contactPhone")} placeholder="07xxxxxxxxx" />
                <Field label="البريد الإلكتروني" value={form.contactEmail} onChange={f("contactEmail")} placeholder="info@company.com" />
              </div>
              <Field label="ملاحظات" value={form.notes} onChange={f("notes")} placeholder="بغداد — قطاع التجزئة" />

              {createMutation.error && (
                <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                  {(createMutation.error as Error).message}
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={() => createMutation.mutate(form)}
                  disabled={!form.name.trim() || createMutation.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {createMutation.isPending ? "جاري الإنشاء..." : <><KeyRound className="w-4 h-4" /> إنشاء الترخيص</>}
                </button>
                <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[var(--theme-border)] text-sm text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition">
                  إلغاء
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Deploy ── */}
          {step === 2 && created && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-[var(--theme-text)]">انشر النظام لـ {created.name}</h2>

              {/* License key */}
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    <KeyRound className="w-3.5 h-3.5" /> مفتاح الترخيص — سيُضاف تلقائياً عند النشر
                  </span>
                  <button onClick={() => copy("key", `LICENSE_KEY=${created.licenseKey}`)}
                    className={`text-xs px-2 py-0.5 rounded-lg flex items-center gap-1 transition ${copied === "key" ? "text-emerald-600" : "text-slate-500 hover:text-slate-700"}`}>
                    <Copy className="w-3 h-3" />{copied === "key" ? "تم النسخ!" : "نسخ"}
                  </button>
                </div>
                <code className="text-[10px] text-emerald-800 dark:text-emerald-300 break-all font-mono">
                  {created.licenseKey.slice(0, 60)}…
                </code>
              </div>

              {/* Railway deploy button */}
              <a href={railwayDeployUrl(created.licenseKey, created.name)} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#0B0D0E] hover:bg-[#1a1d1f] text-white text-sm font-semibold transition border border-white/10">
                <Rocket className="w-4 h-4" />
                نشر Backend على Railway (بزر واحد)
                <ExternalLink className="w-3.5 h-3.5 opacity-60" />
              </a>

              {/* Vercel deploy button */}
              <a href={vercelDeployUrl(slugify(created.name))} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-[#000] hover:bg-[#111] text-white text-sm font-semibold transition border border-white/10">
                <Globe className="w-4 h-4" />
                نشر Frontend على Vercel (بزر واحد)
                <ExternalLink className="w-3.5 h-3.5 opacity-60" />
              </a>

              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <p className="font-semibold">📌 بعد النشر — لا تنسَ:</p>
                <p>1. في Railway: أضف قاعدة بيانات PostgreSQL</p>
                <p>2. أضف <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">JWT_SECRET</code> برمز عشوائي قوي</p>
                <p>3. في Vercel: أضف <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">VITE_API_URL=https://&lt;railway-url&gt;/api</code></p>
                <p>4. في Railway: أضف <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">ALLOWED_ORIGINS=https://&lt;vercel-url&gt;</code></p>
              </div>

              <button onClick={() => setStep(3)}
                className="w-full py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 transition flex items-center justify-center gap-2">
                تم النشر — سجّل الروابط <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ── Step 3: Save URLs + WhatsApp card ── */}
          {step === 3 && created && (
            <div className="space-y-4">
              <h2 className="text-base font-bold text-[var(--theme-text)]">سجّل روابط {created.name}</h2>

              <Field label="رابط الـ Backend (Railway)" value={urls.backendUrl}
                onChange={e => setUrls(u => ({ ...u, backendUrl: e.target.value }))}
                placeholder="https://xxx.up.railway.app" />
              <Field label="رابط الـ Frontend (Vercel)" value={urls.frontendUrl}
                onChange={e => setUrls(u => ({ ...u, frontendUrl: e.target.value }))}
                placeholder="https://makhzouni-xxx.vercel.app" />

              {/* WhatsApp message preview */}
              <div className="bg-[var(--theme-bg)] rounded-xl border border-[var(--theme-border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[var(--theme-text)] flex items-center gap-1.5">
                    <MessageCircle className="w-3.5 h-3.5 text-green-500" /> رسالة تسليم واتساب
                  </span>
                  <button onClick={() => copy("wa", buildWhatsAppMsg({
                    ...created, backendUrl: urls.backendUrl || null, frontendUrl: urls.frontendUrl || null,
                  }))} className={`text-xs flex items-center gap-1 px-2 py-0.5 rounded-lg transition ${copied === "wa" ? "text-green-600" : "text-slate-500 hover:text-slate-700"}`}>
                    <Copy className="w-3 h-3" />{copied === "wa" ? "تم النسخ!" : "نسخ"}
                  </button>
                </div>
                <pre className="text-[10px] text-[var(--theme-text-muted)] whitespace-pre-wrap leading-relaxed font-mono">
                  {buildWhatsAppMsg({ ...created, backendUrl: urls.backendUrl || null, frontendUrl: urls.frontendUrl || null })}
                </pre>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => updateMutation.mutate({ id: created.id, ...urls })}
                  disabled={updateMutation.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center gap-2">
                  {updateMutation.isPending ? "جاري الحفظ..." : <><CheckCircle className="w-4 h-4" /> حفظ وإغلاق</>}
                </button>
                <button onClick={onClose} className="px-4 py-2 rounded-xl border border-[var(--theme-border)] text-sm text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition">
                  تخطي
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Client card ───────────────────────────────────────────────────────────────

function ClientCard({ client }: { client: LicensedClient }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied]     = useState<string | null>(null)
  const [editUrls, setEditUrls] = useState(false)
  const [urls, setUrls]         = useState({ backendUrl: client.backendUrl ?? "", frontendUrl: client.frontendUrl ?? "" })

  function copy(key: string, text: string) {
    navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 2500)
  }

  const revokeMutation = useMutation({
    mutationFn: revokeLicensedClient,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licensed-clients"] }),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteLicensedClient,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licensed-clients"] }),
  })
  const updateMutation = useMutation({
    mutationFn: (p: { id: string; backendUrl?: string; frontendUrl?: string }) => updateLicensedClient(p.id, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["licensed-clients"] }); setEditUrls(false) },
  })

  const waMsg = buildWhatsAppMsg(client)
  const waLink = client.contactPhone
    ? `https://wa.me/${client.contactPhone.replace(/\D/g, "")}?text=${encodeURIComponent(waMsg)}`
    : null

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="bg-[var(--theme-card)] rounded-2xl border border-[var(--theme-border)] overflow-hidden">

      {/* Card header */}
      <div className="p-4 flex items-start gap-3">
        <StatusIcon s={client.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[var(--theme-text)]">{client.name}</span>
            {statusBadge(client.status)}
            {client.daysLeft !== undefined && !client.isRevoked && client.daysLeft > 0 && (
              <span className="text-xs text-[var(--theme-text-muted)]">{client.daysLeft} يوم</span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 mt-1">
            {client.frontendUrl ? (
              <a href={client.frontendUrl} target="_blank" rel="noreferrer"
                className="text-xs text-[var(--theme-accent)] flex items-center gap-1 hover:underline">
                <Globe className="w-3 h-3" /> فتح النظام
              </a>
            ) : (
              <span className="text-xs text-[var(--theme-text-muted)] flex items-center gap-1 italic">
                <Globe className="w-3 h-3" /> لم يُنشر بعد
              </span>
            )}
            {client.contactPhone && (
              <span className="text-xs text-[var(--theme-text-muted)]">{client.contactPhone}</span>
            )}
            <span className="text-xs text-[var(--theme-text-muted)]">
              ينتهي: {client.expiresAt.slice(0, 10)}
            </span>
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 shrink-0">
          {waLink && (
            <a href={waLink} target="_blank" rel="noreferrer"
              className="p-1.5 rounded-lg text-green-500 hover:bg-green-50 dark:hover:bg-green-900/20 transition"
              title="إرسال رسالة واتساب">
              <MessageCircle className="w-4 h-4" />
            </a>
          )}
          {!waLink && (
            <button onClick={() => copy("wa", waMsg)}
              className={`p-1.5 rounded-lg transition ${copied === "wa" ? "text-green-500" : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]"}`}
              title="نسخ رسالة واتساب">
              <MessageCircle className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => copy("key", `LICENSE_KEY=${client.licenseKey}`)}
            className={`p-1.5 rounded-lg transition ${copied === "key" ? "text-emerald-500" : "text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)]"}`}
            title="نسخ LICENSE_KEY">
            <KeyRound className="w-4 h-4" />
          </button>
          <button onClick={() => setExpanded(e => !e)}
            className="p-1.5 rounded-lg text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {copied === "key" && (
        <div className="px-4 pb-2 text-xs text-emerald-500">✓ تم نسخ LICENSE_KEY — الصق في Railway Variables</div>
      )}
      {copied === "wa" && (
        <div className="px-4 pb-2 text-xs text-green-500">✓ تم نسخ رسالة التسليم</div>
      )}

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--theme-border)] pt-3">

              {/* Deployment URLs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--theme-text)]">روابط النشر</span>
                  <button onClick={() => setEditUrls(e => !e)}
                    className="text-xs text-[var(--theme-accent)] hover:underline flex items-center gap-1">
                    <Link2 className="w-3 h-3" />{editUrls ? "إلغاء" : "تعديل"}
                  </button>
                </div>
                {editUrls ? (
                  <div className="space-y-2">
                    <input value={urls.backendUrl}
                      onChange={e => setUrls(u => ({ ...u, backendUrl: e.target.value }))}
                      placeholder="https://xxx.up.railway.app"
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]" />
                    <input value={urls.frontendUrl}
                      onChange={e => setUrls(u => ({ ...u, frontendUrl: e.target.value }))}
                      placeholder="https://makhzouni-xxx.vercel.app"
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]" />
                    <button onClick={() => updateMutation.mutate({ id: client.id, ...urls })}
                      disabled={updateMutation.isPending}
                      className="px-3 py-1.5 text-xs rounded-lg bg-[var(--theme-accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50 transition">
                      {updateMutation.isPending ? "جاري الحفظ..." : "حفظ"}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <UrlChip icon={<Server className="w-3 h-3" />} label="Backend" url={client.backendUrl} />
                    <UrlChip icon={<Globe  className="w-3 h-3" />} label="Frontend" url={client.frontendUrl} />
                  </div>
                )}
              </div>

              {/* Railway deploy link */}
              {!client.backendUrl && (
                <a href={railwayDeployUrl(client.licenseKey, client.name)} target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2 rounded-xl bg-[#0B0D0E] hover:bg-[#1a1d1f] text-white text-xs font-semibold transition">
                  <Rocket className="w-3.5 h-3.5" /> نشر على Railway الآن
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              )}

              {/* Notes */}
              {client.notes && (
                <p className="text-xs text-[var(--theme-text-muted)] italic">{client.notes}</p>
              )}

              {/* Danger actions */}
              <div className="flex gap-2 pt-1">
                {!client.isRevoked && (
                  <button onClick={() => { if (confirm(`إلغاء ترخيص "${client.name}"?`)) revokeMutation.mutate(client.id) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-amber-600 border border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition">
                    <XCircle className="w-3.5 h-3.5" /> إلغاء الترخيص
                  </button>
                )}
                <button onClick={() => { if (confirm(`حذف "${client.name}" نهائياً؟`)) deleteMutation.mutate(client.id) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-500 border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 transition">
                  <Trash2 className="w-3.5 h-3.5" /> حذف
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function UrlChip({ icon, label, url }: { icon: React.ReactNode; label: string; url?: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noreferrer"
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--theme-bg)] border border-[var(--theme-border)] text-xs text-[var(--theme-accent)] hover:underline truncate">
      {icon} <span className="truncate">{label}</span> <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
    </a>
  ) : (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[var(--theme-bg)] border border-dashed border-[var(--theme-border)] text-xs text-[var(--theme-text-muted)] truncate">
      {icon} <span className="truncate">{label} — لم يُضَف</span>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, type = "text", min, max }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
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

// ── main page ─────────────────────────────────────────────────────────────────

export function SuperAdminPage() {
  const { data: clients = [], isLoading } = useQuery({ queryKey: ["licensed-clients"], queryFn: getLicensedClients })
  const { data: ownLicense } = useQuery({ queryKey: ["license-status"], queryFn: getLicenseStatus })

  const [showWizard, setShowWizard] = useState(false)
  const [lastCreated, setLastCreated] = useState<LicensedClient | null>(null)

  const activeCount   = clients.filter(c => c.status === "valid" || c.status === "expiring").length
  const deployedCount = clients.filter(c => c.frontendUrl).length

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] p-4 md:p-8" dir="rtl">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--theme-text)] flex items-center gap-2">
              <Rocket className="w-6 h-6 text-[var(--theme-accent)]" />
              لوحة المطوّر — إدارة الأنظمة
            </h1>
            <p className="text-sm text-[var(--theme-text-muted)] mt-1">
              {activeCount} ترخيص نشط · {deployedCount} منشور · {clients.length} إجمالي
            </p>
          </div>
          <button onClick={() => setShowWizard(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 transition shadow-lg shadow-[var(--theme-accent)]/20">
            <Plus className="w-4 h-4" /> عميل جديد
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "تراخيص نشطة",  value: activeCount,   color: "text-emerald-500" },
            { label: "أنظمة منشورة", value: deployedCount,  color: "text-blue-500" },
            { label: "إجمالي العملاء", value: clients.length, color: "text-[var(--theme-accent)]" },
          ].map(s => (
            <div key={s.label} className="bg-[var(--theme-card)] rounded-2xl border border-[var(--theme-border)] p-4 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-[var(--theme-text-muted)] mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Own license */}
        {ownLicense && ownLicense.status !== "missing" && (
          <div className="mb-4 p-3 rounded-xl bg-[var(--theme-card)] border border-[var(--theme-border)] flex items-center gap-3">
            <StatusIcon s={ownLicense.status as LicensedClient["status"]} />
            <div>
              <p className="text-sm font-medium text-[var(--theme-text)]">ترخيص هذا النظام — {ownLicense.clientName}</p>
              <p className="text-xs text-[var(--theme-text-muted)]">
                {ownLicense.expiresAt?.slice(0, 10)} · {statusBadge(ownLicense.status as LicensedClient["status"])}
              </p>
            </div>
          </div>
        )}

        {/* Last created banner */}
        <AnimatePresence>
          {lastCreated && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
              <span className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                ✓ تم إنشاء نظام {lastCreated.name} بنجاح
              </span>
              <button onClick={() => setLastCreated(null)} className="text-emerald-600 hover:text-emerald-800 text-xs">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Client list */}
        {isLoading ? (
          <div className="text-center py-20 text-[var(--theme-text-muted)] text-sm">جاري التحميل...</div>
        ) : clients.length === 0 ? (
          <div className="text-center py-24 text-[var(--theme-text-muted)]">
            <Rocket className="w-14 h-14 mx-auto mb-4 opacity-20" />
            <p className="text-base font-medium">لا يوجد عملاء بعد</p>
            <p className="text-sm mt-1">اضغط "عميل جديد" لإنشاء أول نظام</p>
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map(c => <ClientCard key={c.id} client={c} />)}
          </div>
        )}

        {/* Wizard */}
        <AnimatePresence>
          {showWizard && (
            <NewClientWizard
              onClose={() => setShowWizard(false)}
              onDone={(c) => { setLastCreated(c); setShowWizard(false) }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
