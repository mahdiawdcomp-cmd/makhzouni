import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Plus, Play, Pause, Trash2, Clock, Users, CheckCircle2, XCircle,
  Upload, Image as ImageIcon, UserPlus, DownloadCloud, Pencil, MessageSquareReply, Send,
} from "lucide-react"
import {
  convertProspect, deleteProspect, getProspects, importProspects, importProspectsFromImages,
  createCampaign, updateCampaign, deleteCampaign, getCampaign, getCampaigns, loadCampaignProspects,
  setCampaignStatus, deleteCampaignRecipient, getSettings, updateSettings,
  getInboundMessages, markInboundMessageRead, replyToInboundMessage,
} from "../api/endpoints"
import type { Campaign, CampaignPayload, CampaignStatus, Prospect, BotRule, InboundMessage, InboundMessageStatus } from "../types/api"

/* ─── Shared helpers ──────────────────────────────────────────────────── */
function parseNumbers(text: string): string[] {
  const found = text.match(/[\d+][\d\s-]{7,}/g) ?? []
  return found.map((s) => s.replace(/[^\d]/g, "")).filter((n) => n.length >= 10)
}
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

/* ══════════════════════════════════════════════════════════════════════ */
export function CampaignsPage() {
  const [tab, setTab] = useState<"prospects" | "send" | "inbox">("prospects")
  const inboxQuery = useQuery({ queryKey: ["inbound-messages-unread-count"], queryFn: () => getInboundMessages({ status: "UNREAD" }), refetchInterval: 20_000 })
  const unreadCount = inboxQuery.data?.unreadCount ?? 0
  return (
    <div dir="rtl" className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-gray-900">
          <Users className="h-6 w-6 text-emerald-600" /> الزبائن الجدد
        </h1>
        <p className="mt-1 text-sm text-gray-500">زبائن محتملين مستقلين عن زبائن المحل + إرسال تلقائي عشوائي لتجنب الحظر</p>
      </div>

      <div className="mb-5 flex gap-2">
        <TabBtn active={tab === "prospects"} onClick={() => setTab("prospects")}>الأرقام (محتملين)</TabBtn>
        <TabBtn active={tab === "send"} onClick={() => setTab("send")}>الإرسال</TabBtn>
        <TabBtn active={tab === "inbox"} onClick={() => setTab("inbox")} badge={unreadCount}>الرسائل الواردة</TabBtn>
      </div>

      {tab === "prospects" ? <ProspectsTab /> : tab === "send" ? <SendTab /> : <InboxTab />}
    </div>
  )
}

function TabBtn({ active, onClick, children, badge }: { active: boolean; onClick: () => void; children: React.ReactNode; badge?: number }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition ${active ? "bg-emerald-600 text-white shadow" : "bg-gray-100 text-gray-600"}`}>
      {children}
      {!!badge && <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{badge}</span>}
    </button>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   PROSPECTS TAB
══════════════════════════════════════════════════════════════════════ */
function ProspectsTab() {
  const qc = useQueryClient()
  const [paste, setPaste] = useState("")
  const [uploadMsg, setUploadMsg] = useState("")
  const [convertTarget, setConvertTarget] = useState<Prospect | null>(null)

  const q = useQuery({ queryKey: ["prospects"], queryFn: () => getProspects(), refetchInterval: 20_000 })
  const data = q.data
  const parsed = useMemo(() => parseNumbers(paste), [paste])

  const pasteMut = useMutation({
    mutationFn: () => importProspects(parsed.map((phone) => ({ phone }))),
    onSuccess: () => { setPaste(""); qc.invalidateQueries({ queryKey: ["prospects"] }) },
  })
  const imgMut = useMutation({
    mutationFn: (images: string[]) => importProspectsFromImages(images),
    onSuccess: (r) => { setUploadMsg(`أُضيف ${r?.added ?? 0} — مكرر ${r?.duplicates ?? 0}`); qc.invalidateQueries({ queryKey: ["prospects"] }) },
    onError: () => setUploadMsg("تعذر قراءة الصور — تأكد أن OCR مفعّل"),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => deleteProspect(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prospects"] }),
  })

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadMsg(`جاري قراءة ${files.length} صورة...`)
    const imgs = await Promise.all(Array.from(files).map(fileToDataUrl))
    imgMut.mutate(imgs)
  }

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="الكل" value={data?.total ?? 0} />
        <Stat label="محتملين" value={data?.newCount ?? 0} color="text-emerald-600" />
        <Stat label="تحوّلوا لزبائن" value={data?.convertedCount ?? 0} color="text-blue-600" />
      </div>

      {/* Import: paste */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <label className="mb-1 block text-xs font-bold text-gray-600">لصق أرقام (رقم بكل سطر)</label>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} dir="ltr"
          placeholder={"07701234567\n+9647809998887"}
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-500">وجدت <b className="text-emerald-600">{parsed.length}</b> رقم</span>
          <button disabled={parsed.length === 0 || pasteMut.isPending} onClick={() => pasteMut.mutate()}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            <Upload className="h-4 w-4" /> {pasteMut.isPending ? "..." : "إضافة"}
          </button>
        </div>
        {pasteMut.data && <p className="mt-2 text-xs text-emerald-700">أُضيف {pasteMut.data.added} — مكرر {pasteMut.data.duplicates}</p>}
      </div>

      {/* Import: screenshots OCR */}
      <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/40 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-700">
          <ImageIcon className="h-4 w-4 text-emerald-600" /> رفع سكرينات (استخراج الأرقام تلقائياً)
        </div>
        <p className="mt-1 text-[11px] text-gray-500">اختر صور قائمة الأرقام — النظام يقرأها ويضيف الأرقام.</p>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white">
          <Upload className="h-4 w-4" /> اختيار صور
          <input type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => onFiles(e.target.files)} disabled={imgMut.isPending} />
        </label>
        {uploadMsg && <p className="mt-2 text-xs text-emerald-700">{uploadMsg}</p>}
      </div>

      {/* List */}
      <div>
        <h3 className="mb-2 text-sm font-bold text-gray-700">القائمة ({data?.items.length ?? 0})</h3>
        <div className="space-y-1.5">
          {data?.items.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-bold text-gray-800">{p.name}</span>
                <span className="mr-2 font-mono text-xs text-gray-500" dir="ltr">{p.phone}</span>
              </div>
              <div className="flex items-center gap-2">
                {p.status === "CONVERTED" ? (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">زبون</span>
                ) : (
                  <button onClick={() => setConvertTarget(p)}
                    className="flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
                    <UserPlus className="h-3.5 w-3.5" /> تحويل
                  </button>
                )}
                <button onClick={() => delMut.mutate(p.id)} className="text-gray-300 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {data && data.items.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">لا توجد أرقام — أضف بالأعلى</p>
          )}
        </div>
      </div>

      {convertTarget && (
        <ConvertModal prospect={convertTarget} onClose={() => setConvertTarget(null)}
          onDone={() => { setConvertTarget(null); qc.invalidateQueries({ queryKey: ["prospects"] }) }} />
      )}
    </div>
  )
}

function Stat({ label, value, color = "text-gray-800" }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 text-center">
      <div className={`text-2xl font-extrabold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  )
}

function ConvertModal({ prospect, onClose, onDone }: { prospect: Prospect; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")
  const mut = useMutation({
    mutationFn: () => convertProspect(prospect.id, { name: name.trim(), address: address.trim() || undefined }),
    onSuccess: onDone,
  })
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-extrabold text-gray-900">تحويل إلى زبون</h3>
        <p className="mb-4 font-mono text-xs text-gray-500" dir="ltr">{prospect.phone}</p>
        <label className="mb-1 block text-xs font-bold text-gray-600">اسم الزبون</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم الكامل"
          className="mb-3 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
        <label className="mb-1 block text-xs font-bold text-gray-600">العنوان (اختياري)</label>
        <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان"
          className="mb-4 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
        {mut.isError && <p className="mb-2 text-xs text-red-600">تعذر التحويل — تأكد من الاسم.</p>}
        <div className="flex gap-2">
          <button disabled={name.trim().length < 2 || mut.isPending} onClick={() => mut.mutate()}
            className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {mut.isPending ? "..." : "تحويل لزبون"}
          </button>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-bold text-gray-600">إلغاء</button>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   SEND TAB (campaigns)
══════════════════════════════════════════════════════════════════════ */
const STATUS_LABEL: Record<CampaignStatus, string> = { DRAFT: "مسودة", RUNNING: "يعمل", PAUSED: "متوقف", DONE: "مكتمل" }
const STATUS_COLOR: Record<CampaignStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-600", RUNNING: "bg-emerald-100 text-emerald-700",
  PAUSED: "bg-amber-100 text-amber-700", DONE: "bg-blue-100 text-blue-700",
}
const emptyForm: CampaignPayload = {
  name: "", messages: [], includeCatalogLink: true,
  minDelaySec: 90, maxDelaySec: 240, dailyMin: 20, dailyMax: 50, activeStartHour: 9, activeEndHour: 21,
}

const DEFAULT_AUTO_REPLY_MESSAGE = "تمام 👍 هذا رابط كروبنا على الواتساب:\n{{link}}"
const DEFAULT_AUTO_REPLY_KEYWORDS = "تم, نعم, اوكي, ok"

function AutoReplySettings() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const [link, setLink] = useState("")
  const [keywordsText, setKeywordsText] = useState(DEFAULT_AUTO_REPLY_KEYWORDS)
  const [message, setMessage] = useState(DEFAULT_AUTO_REPLY_MESSAGE)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    const s = settingsQuery.data
    if (!s) return
    setLink(s.prospectGroupInviteLink ?? "")
    setKeywordsText((s.prospectAutoReplyKeywords ?? []).join(", ") || DEFAULT_AUTO_REPLY_KEYWORDS)
    setMessage(s.prospectAutoReplyMessage ?? DEFAULT_AUTO_REPLY_MESSAGE)
    setEnabled(s.prospectAutoReplyEnabled ?? false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data])

  const saveMut = useMutation({
    mutationFn: () => updateSettings({
      prospectGroupInviteLink: link.trim(),
      prospectAutoReplyKeywords: keywordsText.split(",").map((k) => k.trim()).filter(Boolean),
      prospectAutoReplyMessage: message.trim() || DEFAULT_AUTO_REPLY_MESSAGE,
      prospectAutoReplyEnabled: enabled,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  })

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-800">
        <MessageSquareReply className="h-4 w-4 text-blue-600" /> الرد التلقائي — رابط كروب الواتساب
      </div>
      <p className="mb-3 text-[11px] text-gray-500">
        لمّا رد الزبون يحتوي إحدى الكلمات بالأسفل، يستلم رسالتك تلقائياً (مرة واحدة لكل رقم).
        يحتاج تفعيل Webhook الوارد من Green API على رابط:
        <code className="mr-1 rounded bg-white px-1 py-0.5 text-[10px]" dir="ltr">/api/public/whatsapp/incoming-webhook</code>
      </p>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">رابط دعوة الكروب</label>
          <input value={link} onChange={(e) => setLink(e.target.value)} dir="ltr" placeholder="https://chat.whatsapp.com/..."
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">الكلمات الي إذا كتبها الزبون تفعّل الرد (افصل بفاصلة)</label>
          <input value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} placeholder="تم, نعم, اوكي"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">
            نص الرد التلقائي — استخدم <code className="rounded bg-white px-1">{"{{link}}"}</code> بمكان الرابط
          </label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
        تفعيل الرد التلقائي
      </label>
      <button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}
        className="mt-3 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        {saveMut.isPending ? "..." : "حفظ"}
      </button>
      {saveMut.isSuccess && <span className="mr-2 text-xs text-emerald-700">✓ تم الحفظ</span>}
    </div>
  )
}

/* ─── Customer-service bot — table of editable rules ──────────────────── */
const BUILTIN_LABEL: Record<string, string> = {
  STATEMENT: "كشف الحساب (بيانات حقيقية)",
  BALANCE: "الرصيد (بيانات حقيقية)",
  CATALOG_LINK: "رابط الكاتلوك (بيانات حقيقية)",
}

function newRuleId() {
  return `rule-${Math.random().toString(36).slice(2, 10)}`
}

function CustomerBotSettings() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const [enabled, setEnabled] = useState(false)
  const [unknownMessage, setUnknownMessage] = useState("")
  const [rules, setRules] = useState<BotRule[]>([])

  useEffect(() => {
    const s = settingsQuery.data
    if (!s) return
    setEnabled(s.whatsappBotEnabled ?? false)
    setUnknownMessage(s.botUnknownMessage ?? "")
    setRules(s.botRules ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data])

  const saveMut = useMutation({
    mutationFn: () => updateSettings({
      whatsappBotEnabled: enabled,
      botUnknownMessage: unknownMessage.trim(),
      botRules: rules.map((r) => ({ ...r, replyText: r.replyText?.trim() })),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  })

  function updateRule(id: string, patch: Partial<BotRule>) {
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function removeRule(id: string) {
    setRules((rs) => rs.filter((r) => r.id !== id))
  }
  function addRule() {
    setRules((rs) => [...rs, { id: newRuleId(), keywords: [], replyType: "TEXT", replyText: "" }])
  }

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold text-gray-800">
        🤖 بوت خدمة الزبائن — جدول الردود
      </div>
      <p className="mb-3 text-[11px] text-gray-500">
        لمّا زبون قديم (مسجّل بالنظام) يكتب أي صيغة من كلمات صف معيّن، يستلم الرد المقابل تلقائياً.
        أضف أي عدد من الردود (مثلاً: "سلام عليكم" ← "وعليكم السلام"). أي رسالة ما تطابق صف = تروح لتبويب «الرسائل الواردة» للرد اليدوي.
      </p>

      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white p-3 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="mb-1 block text-[10px] font-bold text-gray-500">الكلمات (افصل بفاصلة)</label>
              <input value={rule.keywords.join(", ")}
                onChange={(e) => updateRule(rule.id, { keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-400" dir="rtl" />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold text-gray-500">الرد</label>
              {rule.builtin ? (
                <div className="flex h-[34px] items-center rounded-lg bg-violet-50 px-2.5 text-xs font-semibold text-violet-700">
                  {BUILTIN_LABEL[rule.replyType]}
                </div>
              ) : (
                <input value={rule.replyText ?? ""} onChange={(e) => updateRule(rule.id, { replyText: e.target.value })}
                  placeholder="نص الرد..."
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-400" dir="rtl" />
              )}
            </div>
            <div className="flex items-end justify-end">
              {!rule.builtin && (
                <button onClick={() => removeRule(rule.id)} className="text-gray-300 hover:text-red-500" title="حذف">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button onClick={addRule} className="mt-2 flex items-center gap-1.5 rounded-xl bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-700">
        <Plus className="h-3.5 w-3.5" /> إضافة رد جديد
      </button>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-bold text-gray-600">رد الرسائل غير المعروفة (زبون جديد / رقم غريب / سؤال خارج الجدول)</label>
        <textarea value={unknownMessage} onChange={(e) => setUnknownMessage(e.target.value)} rows={2}
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400" />
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
        تفعيل البوت
      </label>
      <button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}
        className="mt-3 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
        {saveMut.isPending ? "..." : "حفظ"}
      </button>
      {saveMut.isSuccess && <span className="mr-2 text-xs text-emerald-700">✓ تم الحفظ</span>}
    </div>
  )
}

function SendTab() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<Campaign | null>(null)
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setShowForm(true); setEditTarget(null); setSelectedId(null) }}
          className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow active:scale-95">
          <Plus className="h-4 w-4" /> حملة جديدة
        </button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        ⚠️ عشوائي بالكامل: الرسالة + الوقت + العدد اليومي. استعمل رقم مخصص وابدأ بعدد قليل.
      </div>

      <CustomerBotSettings />
      <AutoReplySettings />

      {showForm && (
        <CampaignForm onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ["campaigns"] }) }} />
      )}

      {editTarget && (
        <CampaignForm
          campaignId={editTarget.id}
          initial={{
            name: editTarget.name,
            messages: editTarget.messages,
            includeCatalogLink: editTarget.includeCatalogLink,
            minDelaySec: editTarget.minDelaySec,
            maxDelaySec: editTarget.maxDelaySec,
            dailyMin: editTarget.dailyMin,
            dailyMax: editTarget.dailyMax,
            activeStartHour: editTarget.activeStartHour,
            activeEndHour: editTarget.activeEndHour,
          }}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); qc.invalidateQueries({ queryKey: ["campaigns"] }) }} />
      )}

      <div className="space-y-3">
        {campaigns.length === 0 && !campaignsQuery.isLoading && (
          <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-gray-400">لا توجد حملات بعد</div>
        )}
        {campaigns.map((c) => (
          <CampaignRow key={c.id} campaign={c} onOpen={() => setSelectedId(c.id)}
            onEdit={() => { setEditTarget(c); setShowForm(false); setSelectedId(null) }}
            onToggle={() => statusMut.mutate({ id: c.id, status: c.status === "RUNNING" ? "PAUSED" : "RUNNING" })}
            onDelete={() => { if (confirm(`حذف حملة «${c.name}»؟`)) deleteMut.mutate(c.id) }} />
        ))}
      </div>

      {selectedId && <CampaignDetailModal id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function CampaignRow({ campaign, onOpen, onEdit, onToggle, onDelete }: {
  campaign: Campaign; onOpen: () => void; onEdit: () => void; onToggle: () => void; onDelete: () => void
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
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_COLOR[campaign.status]}`}>{STATUS_LABEL[campaign.status]}</span>
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
          <button onClick={onEdit}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 active:scale-90" title="تعديل">
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={onToggle}
            className={`flex h-9 w-9 items-center justify-center rounded-xl text-white active:scale-90 ${campaign.status === "RUNNING" ? "bg-amber-500" : "bg-emerald-600"}`}
            title={campaign.status === "DONE" ? "إعادة تشغيل (بعد إضافة أرقام جديدة)" : undefined}>
            {campaign.status === "RUNNING" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button onClick={onDelete} className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-red-500 active:scale-90">
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

function CampaignForm({ onClose, onSaved, initial, campaignId }: {
  onClose: () => void; onSaved: () => void; initial?: CampaignPayload; campaignId?: string
}) {
  const [form, setForm] = useState<CampaignPayload>(initial ?? emptyForm)
  const [messagesText, setMessagesText] = useState((initial?.messages ?? []).join("\n---\n"))
  const saveMut = useMutation({
    mutationFn: () => {
      const messages = messagesText.split(/\n-{2,}\n/).map((m) => m.trim()).filter(Boolean)
      return campaignId ? updateCampaign(campaignId, { ...form, messages }) : createCampaign({ ...form, messages })
    },
    onSuccess: onSaved,
  })
  const set = <K extends keyof CampaignPayload>(k: K, v: CampaignPayload[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (v: string) => (v === "" ? 0 : Math.max(0, parseInt(v, 10) || 0))

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5">
      <h2 className="mb-4 font-bold text-gray-900">{campaignId ? "تعديل الحملة" : "حملة جديدة"}</h2>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">اسم الحملة</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="مثلاً: عرض جديد"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">
            نصوص الرسائل — افصل بين كل صيغة بسطر فيه <code className="rounded bg-gray-100 px-1">---</code>
          </label>
          <textarea value={messagesText} onChange={(e) => setMessagesText(e.target.value)} rows={6}
            placeholder={"مرحباً! وصلتنا بضاعة جديدة 🌟\n---\nأهلاً، شوف عروضنا 🛍️"}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
          <p className="mt-1 text-[11px] text-gray-400">تتدوّر الصيغ عشوائياً مع كل رسالة.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.includeCatalogLink} onChange={(e) => set("includeCatalogLink", e.target.checked)} className="h-4 w-4" />
          إرفاق رابط الكتلوك تلقائياً
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <NumField label="أقل تأخير (ث)" value={form.minDelaySec} onChange={(v) => set("minDelaySec", v)} num={num} />
          <NumField label="أكثر تأخير (ث)" value={form.maxDelaySec} onChange={(v) => set("maxDelaySec", v)} num={num} />
          <NumField label="أقل عدد/يوم" value={form.dailyMin} onChange={(v) => set("dailyMin", v)} num={num} />
          <NumField label="أكثر عدد/يوم" value={form.dailyMax} onChange={(v) => set("dailyMax", v)} num={num} />
          <NumField label="بداية الساعة" value={form.activeStartHour} onChange={(v) => set("activeStartHour", v)} num={num} />
          <NumField label="نهاية الساعة" value={form.activeEndHour} onChange={(v) => set("activeEndHour", v)} num={num} />
        </div>
        {saveMut.isError && <p className="text-xs text-red-600">تعذر الحفظ — تأكد من الاسم ووجود رسالة.</p>}
        <div className="flex gap-2">
          <button disabled={saveMut.isPending || !form.name.trim()} onClick={() => saveMut.mutate()}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {saveMut.isPending ? "..." : "حفظ"}
          </button>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-bold text-gray-600">إلغاء</button>
        </div>
      </div>
    </div>
  )
}

function NumField({ label, value, onChange, num }: { label: string; value: number | undefined; onChange: (v: number) => void; num: (v: string) => number }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-bold text-gray-600">{label}</label>
      <input type="number" value={value ?? 0} onChange={(e) => onChange(num(e.target.value))}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400" />
    </div>
  )
}

function CampaignDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const detailQuery = useQuery({ queryKey: ["campaign", id], queryFn: () => getCampaign(id), refetchInterval: 10_000 })
  const campaign = detailQuery.data

  const loadMut = useMutation({
    mutationFn: () => loadCampaignProspects(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["campaign", id] }); qc.invalidateQueries({ queryKey: ["campaigns"] }) },
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
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4">
            <p className="mb-2 text-xs text-gray-600">حمّل الزبائن المحتملين (تبويب الأرقام) كمستلمين لهذه الحملة.</p>
            <button disabled={loadMut.isPending} onClick={() => loadMut.mutate()}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              <DownloadCloud className="h-4 w-4" /> {loadMut.isPending ? "..." : "تحميل الأرقام المحتملة"}
            </button>
            {loadMut.data && <p className="mt-2 text-xs text-emerald-700">أُضيف {loadMut.data.added} — مكرر {loadMut.data.duplicates}</p>}
          </div>

          <h3 className="mb-2 text-sm font-bold text-gray-700">المستلمون ({campaign?.recipients.length ?? 0})</h3>
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
                    <button onClick={() => removeMut.mutate(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              </div>
            ))}
            {campaign && campaign.recipients.length === 0 && (
              <p className="py-6 text-center text-sm text-gray-400">لا مستلمين — اضغط «تحميل الأرقام المحتملة»</p>
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

/* ══════════════════════════════════════════════════════════════════════
   INBOX TAB (الرسائل الواردة)
══════════════════════════════════════════════════════════════════════ */
const SOURCE_LABEL: Record<string, string> = {
  CUSTOMER_UNMATCHED: "زبون قديم — سؤال غير معروف",
  PROSPECT: "زبون جديد (محتمل)",
  UNKNOWN: "رقم غير مسجل",
}
const SOURCE_COLOR: Record<string, string> = {
  CUSTOMER_UNMATCHED: "bg-blue-100 text-blue-700",
  PROSPECT: "bg-emerald-100 text-emerald-700",
  UNKNOWN: "bg-gray-100 text-gray-600",
}

function InboxTab() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<InboundMessageStatus | "ALL">("ALL")
  const [openId, setOpenId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ["inbound-messages", filter],
    queryFn: () => getInboundMessages(filter === "ALL" ? undefined : { status: filter }),
    refetchInterval: 15_000,
  })
  const data = q.data

  const readMut = useMutation({
    mutationFn: (id: string) => markInboundMessageRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound-messages"] }),
  })

  function openMessage(m: InboundMessage) {
    setOpenId(m.id)
    if (m.status === "UNREAD") readMut.mutate(m.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["ALL", "UNREAD", "READ", "REPLIED"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${filter === f ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600"}`}>
            {f === "ALL" ? "الكل" : f === "UNREAD" ? "غير مقروءة" : f === "READ" ? "مقروءة" : "مردود عليها"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {data?.items.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-gray-400">لا توجد رسائل</div>
        )}
        {data?.items.map((m) => (
          <button key={m.id} onClick={() => openMessage(m)}
            className={`block w-full rounded-2xl border p-3 text-right transition ${m.status === "UNREAD" ? "border-emerald-300 bg-emerald-50/40" : "border-gray-200 bg-white"}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {m.status === "UNREAD" && <span className="h-2 w-2 rounded-full bg-rose-500" />}
                <span className="font-bold text-gray-800" dir="ltr">{m.phone}</span>
                {m.name && <span className="text-xs text-gray-400">{m.name}</span>}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SOURCE_COLOR[m.source]}`}>{SOURCE_LABEL[m.source]}</span>
            </div>
            <p className="mt-1.5 truncate text-sm text-gray-600">{m.messageText}</p>
            {m.status === "REPLIED" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> تم الرد: {m.replyText}</p>
            )}
          </button>
        ))}
      </div>

      {openId && data && (
        <ReplyModal message={data.items.find((m) => m.id === openId)!} onClose={() => setOpenId(null)}
          onSent={() => { setOpenId(null); qc.invalidateQueries({ queryKey: ["inbound-messages"] }) }} />
      )}
    </div>
  )
}

function ReplyModal({ message, onClose, onSent }: { message: InboundMessage; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState("")
  const mut = useMutation({
    mutationFn: () => replyToInboundMessage(message.id, text),
    onSuccess: onSent,
  })
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-sm text-gray-800" dir="ltr">{message.phone}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SOURCE_COLOR[message.source]}`}>{SOURCE_LABEL[message.source]}</span>
        </div>
        <div className="mb-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">{message.messageText}</div>
        <label className="mb-1 block text-xs font-bold text-gray-600">ردّك</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
          placeholder="اكتب الرد هنا..."
          className="mb-3 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
        {mut.isError && <p className="mb-2 text-xs text-red-600">تعذر إرسال الرد — تأكد من إعدادات واتساب.</p>}
        <div className="flex gap-2">
          <button disabled={!text.trim() || mut.isPending} onClick={() => mut.mutate()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            <Send className="h-4 w-4" /> {mut.isPending ? "..." : "إرسال"}
          </button>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-bold text-gray-600">إغلاق</button>
        </div>
      </div>
    </div>
  )
}

export default CampaignsPage
