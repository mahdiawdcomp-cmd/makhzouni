import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createLicensedClient,
  deleteLicensedClient,
  getLicensedClients,
  getLicenseStatus,
  revokeLicensedClient,
  type LicensedClient,
} from "../api/endpoints"
import {
  CheckCircle,
  Clock,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

// ── helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: LicensedClient["status"]) {
  const map: Record<string, { label: string; cls: string }> = {
    valid:    { label: "ساري",     cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
    expiring: { label: "ينتهي قريباً", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
    expired:  { label: "منتهي",   cls: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" },
    revoked:  { label: "ملغي",    cls: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  }
  const s = map[status ?? "valid"] ?? map.valid
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
}

function StatusIcon({ status }: { status: LicensedClient["status"] }) {
  if (status === "valid")    return <CheckCircle className="w-5 h-5 text-emerald-500" />
  if (status === "expiring") return <Clock className="w-5 h-5 text-amber-500" />
  if (status === "revoked")  return <XCircle className="w-5 h-5 text-slate-400" />
  return <ShieldAlert className="w-5 h-5 text-red-500" />
}

// ── main component ────────────────────────────────────────────────────────────

export function SuperAdminPage() {
  const qc = useQueryClient()
  const { data: clients = [], isLoading } = useQuery({ queryKey: ["licensed-clients"], queryFn: getLicensedClients })
  const { data: ownLicense } = useQuery({ queryKey: ["license-status"], queryFn: getLicenseStatus })

  const [showCreate, setShowCreate] = useState(false)
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)

  // form state
  const [form, setForm] = useState({ name: "", months: 12, notes: "" })

  const createMutation = useMutation({
    mutationFn: createLicensedClient,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["licensed-clients"] }); setShowCreate(false); setForm({ name: "", months: 12, notes: "" }) },
  })

  const revokeMutation = useMutation({
    mutationFn: revokeLicensedClient,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licensed-clients"] }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteLicensedClient,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["licensed-clients"] }),
  })

  function copyKey(id: string, key: string) {
    navigator.clipboard.writeText(key)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  function toggleKey(id: string) {
    setVisibleKeys(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Railway env-var instructions string for a given client
  function railwayInstructions(client: LicensedClient) {
    return `LICENSE_KEY=${client.licenseKey}`
  }

  const activeCount = clients.filter(c => c.status === "valid" || c.status === "expiring").length

  return (
    <div className="min-h-screen bg-[var(--theme-bg)] p-4 md:p-8" dir="rtl">
      {/* ── Header ── */}
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--theme-text)] flex items-center gap-2">
              <KeyRound className="w-6 h-6 text-[var(--theme-accent)]" />
              لوحة المطوّر — إدارة العملاء
            </h1>
            <p className="text-sm text-[var(--theme-text-muted)] mt-1">
              {activeCount} عميل نشط · {clients.length} إجمالي
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" />
            عميل جديد
          </button>
        </div>

        {/* ── Own license card ── */}
        {ownLicense && (
          <div className="mb-6 p-4 rounded-2xl bg-[var(--theme-card)] border border-[var(--theme-border)] flex items-center gap-4">
            <StatusIcon status={ownLicense.status as LicensedClient["status"]} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[var(--theme-text)]">
                ترخيص هذا النظام — {ownLicense.clientName ?? "غير مرخّص"}
              </p>
              <p className="text-xs text-[var(--theme-text-muted)]">
                {ownLicense.expiresAt ? `ينتهي: ${ownLicense.expiresAt.slice(0, 10)}` : "وضع تجريبي"} · {statusBadge(ownLicense.status as LicensedClient["status"])}
              </p>
            </div>
          </div>
        )}

        {/* ── Create modal ── */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="w-full max-w-md bg-[var(--theme-card)] rounded-2xl p-6 shadow-2xl"
              >
                <h2 className="text-lg font-bold text-[var(--theme-text)] mb-4">إنشاء ترخيص جديد</h2>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">اسم العميل / الشركة</label>
                    <input
                      className="w-full px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="شركة الأمانة للتجارة"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">مدة الترخيص (شهر)</label>
                    <input
                      type="number"
                      min={1}
                      max={240}
                      className="w-full px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                      value={form.months}
                      onChange={e => setForm(f => ({ ...f, months: Number(e.target.value) }))}
                    />
                    <p className="text-xs text-[var(--theme-text-muted)] mt-1">
                      ينتهي في: {new Date(Date.now() + form.months * 30 * 86_400_000).toLocaleDateString("ar-IQ")}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--theme-text-muted)] mb-1">ملاحظات (اختياري)</label>
                    <input
                      className="w-full px-3 py-2 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--theme-accent)]"
                      value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder="بغداد — قطاع التجزئة"
                    />
                  </div>
                </div>

                {createMutation.error && (
                  <p className="mt-3 text-xs text-red-500">{String((createMutation.error as Error).message)}</p>
                )}

                <div className="flex gap-3 mt-5">
                  <button
                    onClick={() => createMutation.mutate(form)}
                    disabled={!form.name.trim() || createMutation.isPending}
                    className="flex-1 py-2 rounded-xl bg-[var(--theme-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition"
                  >
                    {createMutation.isPending ? "جاري الإنشاء..." : "إنشاء الترخيص"}
                  </button>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 rounded-xl border border-[var(--theme-border)] text-sm text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg)] transition"
                  >
                    إلغاء
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Client list ── */}
        {isLoading ? (
          <div className="text-center py-20 text-[var(--theme-text-muted)] text-sm">جاري التحميل...</div>
        ) : clients.length === 0 ? (
          <div className="text-center py-20 text-[var(--theme-text-muted)]">
            <KeyRound className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">لا يوجد عملاء بعد — أضف أول ترخيص</p>
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map(client => (
              <motion.div
                key={client.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[var(--theme-card)] rounded-2xl border border-[var(--theme-border)] p-4"
              >
                <div className="flex items-start gap-3">
                  <StatusIcon status={client.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[var(--theme-text)]">{client.name}</span>
                      {statusBadge(client.status)}
                      {client.isRevoked && <span className="text-xs text-slate-400">ملغي</span>}
                    </div>
                    <div className="text-xs text-[var(--theme-text-muted)] mt-0.5 space-x-3 flex gap-3 flex-wrap">
                      <span>ينتهي: {client.expiresAt.slice(0, 10)}</span>
                      {client.daysLeft !== undefined && !client.isRevoked && (
                        <span>{client.daysLeft > 0 ? `${client.daysLeft} يوم متبقي` : "منتهي"}</span>
                      )}
                      <span>أُنشئ: {client.createdAt.slice(0, 10)}</span>
                    </div>
                    {client.notes && (
                      <p className="text-xs text-[var(--theme-text-muted)] mt-1 italic">{client.notes}</p>
                    )}

                    {/* License key row */}
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 text-xs bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-lg px-2 py-1 truncate text-[var(--theme-text-muted)] font-mono">
                        {visibleKeys.has(client.id)
                          ? client.licenseKey
                          : `${client.licenseKey.slice(0, 30)}${"•".repeat(20)}`}
                      </code>
                      <button onClick={() => toggleKey(client.id)} title="إظهار / إخفاء"
                        className="p-1.5 rounded-lg hover:bg-[var(--theme-bg)] text-[var(--theme-text-muted)] transition">
                        {visibleKeys.has(client.id) ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => copyKey(client.id, railwayInstructions(client))} title="نسخ للـ Railway"
                        className={`p-1.5 rounded-lg hover:bg-[var(--theme-bg)] transition ${copied === client.id ? "text-emerald-500" : "text-[var(--theme-text-muted)]"}`}>
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {copied === client.id && (
                      <p className="text-xs text-emerald-500 mt-1">✓ تم نسخ: LICENSE_KEY=... — الصق في Railway Variables</p>
                    )}

                    {/* Deployment instructions */}
                    <details className="mt-2">
                      <summary className="text-xs text-[var(--theme-accent)] cursor-pointer hover:underline select-none">
                        خطوات النشر لهذا العميل
                      </summary>
                      <ol className="mt-2 text-xs text-[var(--theme-text-muted)] space-y-1 list-decimal list-inside bg-[var(--theme-bg)] rounded-lg p-3 border border-[var(--theme-border)]">
                        <li>اذهب إلى Railway → New Project → Deploy from GitHub Repo</li>
                        <li>اختر مستودع مخزوني (inventory-backend)</li>
                        <li>أضف متغيرات البيئة: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-[0.65rem]">DATABASE_URL</code>, <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-[0.65rem]">JWT_SECRET</code></li>
                        <li>أضف:
                          <code className="block bg-slate-200 dark:bg-slate-700 px-2 py-1 rounded text-[0.65rem] mt-1 break-all select-all">
                            LICENSE_KEY={client.licenseKey}
                          </code>
                        </li>
                        <li>انشر الـ Frontend على Vercel مع: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-[0.65rem]">VITE_API_URL=https://&lt;railway-url&gt;/api</code></li>
                        <li>سلّم الروابط للعميل مع كلمة المرور الافتراضية</li>
                      </ol>
                    </details>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {!client.isRevoked && (
                      <button
                        onClick={() => { if (confirm(`إلغاء ترخيص "${client.name}"?`)) revokeMutation.mutate(client.id) }}
                        className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition"
                        title="إلغاء الترخيص"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => { if (confirm(`حذف سجل "${client.name}" نهائياً?`)) deleteMutation.mutate(client.id) }}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
                      title="حذف"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
