import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Send,
  Plus,
  Play,
  Pause,
  Trash2,
  Clock,
  Users,
  CheckCircle2,
  XCircle,
  Upload,
} from "lucide-react"
import {
  addCampaignRecipients,
  createCampaign,
  deleteCampaign,
  deleteCampaignRecipient,
  getCampaign,
  getCampaigns,
  setCampaignStatus,
  updateCampaign,
} from "../api/endpoints"
import type { Campaign, CampaignPayload, CampaignStatus } from "../types/api"

/* ─── Helpers ─────────────────────────────────────────────────────────── */
const STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "مسودة",
  RUNNING: "يعمل",
  PAUSED: "متوقف",
  DONE: "مكتمل",
}
const STATUS_COLOR: Record<CampaignStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  RUNNING: "bg-emerald-100 text-emerald-700",
  PAUSED: "bg-amber-100 text-amber-700",
  DONE: "bg-blue-100 text-blue-700",
}

// Pull WhatsApp-style numbers out of pasted text (one per line or mixed).
function parseNumbers(text: string): string[] {
  const found = text.match(/[\d+][\d\s-]{7,}/g) ?? []
  return found.map((s) => s.replace(/[^\d]/g, "")).filter((n) => n.length >= 10)
}

const emptyForm: CampaignPayload = {
  name: "",
  messages: [],
  includeCatalogLink: true,
  minDelaySec: 90,
  maxDelaySec: 240,
  dailyMin: 20,
  dailyMax: 50,
  activeStartHour: 9,
  activeEndHour: 21,
}

/* ══════════════════════════════════════════════════════════════════════ */
export function CampaignsPage() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const campaignsQuery = useQuery({ queryKey: ["campaigns"], queryFn: getCampaigns, refetchInterval: 15_000 })
  const campaigns = campaignsQuery.data ?? []

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CampaignStatus }) => setCampaignStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCampaign(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["campaigns"] }); setSelectedId(null) },
  })

  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-gray-900">
            <Send className="h-6 w-6 text-emerald-600" /> حملات الزبائن الجدد
          </h1>
          <p className="mt-1 text-sm text-gray-500">إرسال تلقائي عشوائي للرسائل بالخلفية — لتجنب الحظر</p>
        </div>
        <button onClick={() => { setShowForm(true); setSelectedId(null) }}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow transition active:scale-95">
          <Plus className="h-4 w-4" /> حملة جديدة
        </button>
      </div>

      {/* Safety note */}
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        ⚠️ كل شي عشوائي: الرسالة + وقت الإرسال + العدد اليومي. استعمل رقم مخصص وابدأ بعدد قليل واتركه يسخّن تدريجياً.
      </div>

      {showForm && (
        <CampaignForm
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ["campaigns"] }) }}
        />
      )}

      {/* List */}
      <div className="space-y-3">
        {campaigns.length === 0 && !campaignsQuery.isLoading && (
          <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-gray-400">
            لا توجد حملات بعد — أنشئ واحدة وابدأ
          </div>
        )}
        {campaigns.map((c) => (
          <CampaignRow
            key={c.id}
            campaign={c}
            onOpen={() => setSelectedId(c.id)}
            onToggle={() => statusMut.mutate({ id: c.id, status: c.status === "RUNNING" ? "PAUSED" : "RUNNING" })}
            onDelete={() => { if (confirm(`حذف حملة «${c.name}»؟`)) deleteMut.mutate(c.id) }}
          />
        ))}
      </div>

      {selectedId && <CampaignDetailModal id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

/* ─── Row ─────────────────────────────────────────────────────────────── */
function CampaignRow({ campaign, onOpen, onToggle, onDelete }: {
  campaign: Campaign; onOpen: () => void; onToggle: () => void; onDelete: () => void
}) {
  const counts = campaign.counts ?? { PENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 }
  const total = campaign.total ?? 0
  const pct = total > 0 ? Math.round((counts.SENT / total) * 100) : 0
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onOpen} className="min-w-0 flex-1 text-right">
          <div className="flex items-center gap-2">
            <span className="truncate font-bold text-gray-900">{campaign.name}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_COLOR[campaign.status]}`}>
              {STATUS_LABEL[campaign.status]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {total}</span>
            <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {counts.SENT}</span>
            <span className="flex items-center gap-1 text-gray-400"><Clock className="h-3.5 w-3.5" /> {counts.PENDING}</span>
            {counts.FAILED > 0 && <span className="flex items-center gap-1 text-red-500"><XCircle className="h-3.5 w-3.5" /> {counts.FAILED}</span>}
            <span>· اليوم: {campaign.sentToday}/{campaign.dailyCapToday || `${campaign.dailyMin}-${campaign.dailyMax}`}</span>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          {campaign.status !== "DONE" && (
            <button onClick={onToggle}
              className={`flex h-9 w-9 items-center justify-center rounded-xl text-white transition active:scale-90 ${campaign.status === "RUNNING" ? "bg-amber-500" : "bg-emerald-600"}`}
              title={campaign.status === "RUNNING" ? "إيقاف" : "تشغيل"}>
              {campaign.status === "RUNNING" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          )}
          <button onClick={onDelete} className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-red-500 transition active:scale-90" title="حذف">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* ─── Create / edit form ──────────────────────────────────────────────── */
function CampaignForm({ initial, campaignId, onClose, onSaved }: {
  initial?: CampaignPayload; campaignId?: string; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<CampaignPayload>(initial ?? emptyForm)
  const [messagesText, setMessagesText] = useState((initial?.messages ?? []).join("\n---\n"))

  const saveMut = useMutation({
    mutationFn: () => {
      const messages = messagesText.split(/\n-{2,}\n/).map((m) => m.trim()).filter(Boolean)
      const payload: CampaignPayload = { ...form, messages }
      return campaignId ? updateCampaign(campaignId, payload) : createCampaign(payload)
    },
    onSuccess: onSaved,
  })

  const set = <K extends keyof CampaignPayload>(k: K, v: CampaignPayload[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (v: string) => (v === "" ? 0 : Math.max(0, parseInt(v, 10) || 0))

  return (
    <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5">
      <h2 className="mb-4 font-bold text-gray-900">{campaignId ? "تعديل الحملة" : "حملة جديدة"}</h2>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">اسم الحملة</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)}
            placeholder="مثلاً: عرض رمضان للزبائن الجدد"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">
            نصوص الرسائل — افصل بين كل صيغة بسطر فيه <code className="rounded bg-gray-100 px-1">---</code>
          </label>
          <textarea value={messagesText} onChange={(e) => setMessagesText(e.target.value)} rows={6}
            placeholder={"مرحباً! وصلتنا بضاعة جديدة 🌟\n---\nأهلاً، شوف عروضنا الجديدة 🛍️\n---\nسلام عليكم، تفضل تصفح متجرنا"}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
          <p className="mt-1 text-[11px] text-gray-400">تتم تدوير الصيغ عشوائياً مع كل رسالة لتقليل خطر الحظر.</p>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.includeCatalogLink}
            onChange={(e) => set("includeCatalogLink", e.target.checked)} className="h-4 w-4" />
          إرفاق رابط الكتلوك تلقائياً
        </label>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumField label="أقل تأخير (ث)" value={form.minDelaySec} onChange={(v) => set("minDelaySec", v)} />
          <NumField label="أكثر تأخير (ث)" value={form.maxDelaySec} onChange={(v) => set("maxDelaySec", v)} />
          <NumField label="أقل عدد/يوم" value={form.dailyMin} onChange={(v) => set("dailyMin", v)} />
          <NumField label="أكثر عدد/يوم" value={form.dailyMax} onChange={(v) => set("dailyMax", v)} />
          <NumField label="بداية الساعة" value={form.activeStartHour} onChange={(v) => set("activeStartHour", v)} />
          <NumField label="نهاية الساعة" value={form.activeEndHour} onChange={(v) => set("activeEndHour", v)} />
        </div>

        {saveMut.isError && <p className="text-xs text-red-600">تعذر الحفظ — تأكد من الاسم ووجود رسالة واحدة على الأقل.</p>}
        <div className="flex gap-2">
          <button disabled={saveMut.isPending || !form.name.trim()} onClick={() => saveMut.mutate()}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {saveMut.isPending ? "جاري الحفظ..." : "حفظ"}
          </button>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-bold text-gray-600">إلغاء</button>
        </div>
      </div>
    </div>
  )

  function NumField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
    return (
      <div>
        <label className="mb-1 block text-[11px] font-bold text-gray-600">{label}</label>
        <input type="number" value={value ?? 0} onChange={(e) => onChange(num(e.target.value))}
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400" />
      </div>
    )
  }
}

/* ─── Detail modal (recipients + import) ──────────────────────────────── */
function CampaignDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [paste, setPaste] = useState("")
  const detailQuery = useQuery({ queryKey: ["campaign", id], queryFn: () => getCampaign(id), refetchInterval: 10_000 })
  const campaign = detailQuery.data

  const parsed = useMemo(() => parseNumbers(paste), [paste])

  const importMut = useMutation({
    mutationFn: () => addCampaignRecipients(id, parsed.map((phone) => ({ phone }))),
    onSuccess: () => { setPaste(""); qc.invalidateQueries({ queryKey: ["campaign", id] }); qc.invalidateQueries({ queryKey: ["campaigns"] }) },
  })
  const removeMut = useMutation({
    mutationFn: (recipientId: string) => deleteCampaignRecipient(id, recipientId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] }),
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center" dir="rtl" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-3xl bg-white sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="font-extrabold text-gray-900">{campaign?.name ?? "..."}</h2>
          <button onClick={onClose} className="rounded-xl bg-gray-100 p-2 text-gray-500"><XCircle className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Import box */}
          <div className="mb-5 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <label className="mb-1 block text-xs font-bold text-gray-600">إضافة أرقام (الصق الأرقام — رقم بكل سطر)</label>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4}
              placeholder={"07701234567\n07809998887\n..."}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400" dir="ltr" />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-gray-500">تم العثور على <b className="text-emerald-600">{parsed.length}</b> رقم</span>
              <button disabled={parsed.length === 0 || importMut.isPending} onClick={() => importMut.mutate()}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                <Upload className="h-4 w-4" /> {importMut.isPending ? "..." : "إضافة"}
              </button>
            </div>
            {importMut.data && (
              <p className="mt-2 text-xs text-emerald-700">
                أُضيف {importMut.data.added} — مكرر {importMut.data.duplicates}
              </p>
            )}
          </div>

          {/* Recipients list */}
          <h3 className="mb-2 text-sm font-bold text-gray-700">الأرقام ({campaign?.recipients.length ?? 0})</h3>
          <div className="space-y-1.5">
            {campaign?.recipients.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-mono text-gray-800" dir="ltr">{r.phone}</span>
                  {r.name && <span className="mr-2 text-xs text-gray-400">{r.name}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <RecipientBadge status={r.status} />
                  {r.status === "PENDING" && (
                    <button onClick={() => removeMut.mutate(r.id)} className="text-gray-300 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {campaign && campaign.recipients.length === 0 && (
              <p className="py-6 text-center text-sm text-gray-400">لا توجد أرقام — الصقها بالأعلى</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RecipientBadge({ status }: { status: string }) {
  const map: Record<string, { t: string; c: string }> = {
    PENDING: { t: "بالانتظار", c: "bg-gray-100 text-gray-500" },
    SENT: { t: "أُرسل", c: "bg-emerald-100 text-emerald-700" },
    FAILED: { t: "فشل", c: "bg-red-100 text-red-600" },
    SKIPPED: { t: "تخطّي", c: "bg-amber-100 text-amber-700" },
  }
  const s = map[status] ?? map.PENDING
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.c}`}>{s.t}</span>
}

export default CampaignsPage
