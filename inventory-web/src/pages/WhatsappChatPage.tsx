import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CornerUpRight,
  FileText,
  MessageCircle,
  Mic,
  Paperclip,
  Pin,
  Receipt,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  StickyNote,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-react"
import {
  archiveWhatsappConversation,
  createWhatsappQuickReply,
  deleteWhatsappQuickReply,
  getWhatsappConversations,
  getWhatsappMessages,
  getWhatsappQuickReplies,
  markWhatsappConversationRead,
  pinWhatsappConversation,
  sendWhatsappChatMedia,
  sendWhatsappChatMessage,
  sendWhatsappChatReaction,
  updateWhatsappConversationNotes,
} from "../api/endpoints"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import { useAuthStore } from "../store/authStore"
import { cn } from "../utils/cn"
import type { WhatsappChatMessage, WhatsappQuickReply } from "../types/api"

const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"]

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const sec = Math.max(1, Math.floor((Date.now() - then) / 1000))
  if (sec < 60) return `قبل ${sec} ثانية`
  const min = Math.floor(sec / 60)
  if (min < 60) return `قبل ${min} دقيقة`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `قبل ${hr} ساعة`
  const days = Math.floor(hr / 24)
  if (days < 7) return `قبل ${days} يوم`
  return new Date(iso).toLocaleDateString("en-US")
}

function bubbleTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })
}

// Day separator label — "اليوم" / "أمس" / a readable date for anything older.
function dateSeparatorLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return "اليوم"
  if (d.toDateString() === yesterday.toDateString()) return "أمس"
  return d.toLocaleDateString("ar-IQ", { day: "numeric", month: "long", year: "numeric" })
}

// Wraps the first case-insensitive match of `term` inside `text` in <mark> —
// used by the in-conversation search to highlight hits without a heavy library.
function highlightText(text: string, term: string) {
  const needle = term.trim()
  if (!needle) return text
  const idx = text.toLowerCase().indexOf(needle.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-300/70 px-0.5 text-inherit dark:bg-amber-500/40">{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  )
}

// Loose "looks like a phone number" check — digits/spaces/dashes/plus only, 7+ digits.
function looksLikePhone(term: string): boolean {
  const digits = term.replace(/\D/g, "")
  return digits.length >= 7 && /^[\d+\s-]+$/.test(term.trim())
}

// Mirrors mediaFallbackText() on the backend — used only to decide whether a
// caption is worth showing under an image/video (skip it if it's just the
// generic placeholder, since the media itself already says that).
function mediaFallback(mediaType: string | null | undefined, filename?: string | null): string {
  switch (mediaType) {
    case "IMAGE": return "📷 صورة"
    case "DOCUMENT": return filename ? `📄 ${filename}` : "📄 مستند"
    case "AUDIO": return "🎤 رسالة صوتية"
    case "VIDEO": return "🎥 فيديو"
    case "STICKER": return "😀 ملصق"
    case "LOCATION": return "📍 موقع"
    default: return "📎 مرفق"
  }
}

function MediaContent({ m }: { m: WhatsappChatMessage }) {
  if (!m.mediaType || m.mediaType === "LOCATION") return null

  if (!m.mediaDataUrl) {
    return (
      <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-black/5 px-2 py-1.5 text-[11px] dark:bg-white/10">
        <Paperclip className="h-3 w-3 shrink-0" />
        تعذر تحميل المرفق
      </div>
    )
  }

  switch (m.mediaType) {
    case "IMAGE":
    case "STICKER":
      return (
        <img
          src={m.mediaDataUrl}
          alt={m.mediaFilename ?? "صورة"}
          className="mb-1 max-h-72 w-full rounded-lg object-contain"
        />
      )
    case "VIDEO":
      return <video src={m.mediaDataUrl} controls className="mb-1 max-h-72 w-full rounded-lg" />
    case "AUDIO":
      return <audio src={m.mediaDataUrl} controls className="mb-1 w-full" />
    case "DOCUMENT":
      return (
        <a
          href={m.mediaDataUrl}
          download={m.mediaFilename ?? "file"}
          className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-2 py-2 text-[12px] transition hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate">{m.mediaFilename ?? "مستند"}</span>
        </a>
      )
    default:
      return null
  }
}

function BubbleText({ m, searchTerm }: { m: WhatsappChatMessage; searchTerm?: string }) {
  // Sticker/audio never carry a meaningful caption in WhatsApp — skip the
  // redundant fallback label once the media itself is shown.
  if (m.mediaType === "STICKER" || m.mediaType === "AUDIO") return null
  if (m.mediaDataUrl && m.mediaType && m.text === mediaFallback(m.mediaType, m.mediaFilename)) return null

  if (m.mediaType === "LOCATION") {
    const lines = m.text.split("\n")
    return (
      <p dir="auto" className="whitespace-pre-wrap break-words">
        {lines.map((line, i) =>
          line.startsWith("http") ? (
            <a key={i} href={line} target="_blank" rel="noreferrer" className="underline">
              {line}
            </a>
          ) : (
            <span key={i}>
              {line}
              {i < lines.length - 1 ? <br /> : null}
            </span>
          )
        )}
      </p>
    )
  }

  return (
    <p dir="auto" className="whitespace-pre-wrap break-words">
      {searchTerm?.trim() ? highlightText(m.text, searchTerm) : m.text}
    </p>
  )
}

// WhatsApp-style delivery ticks for outbound messages: ✓ sent, ✓✓ delivered,
// ✓✓ (blue) read, ⚠ failed. Statuses arrive via the Meta `statuses` webhook.
function StatusTicks({ m }: { m: WhatsappChatMessage }) {
  switch (m.status) {
    case "READ":
      return <CheckCheck className="h-3.5 w-3.5 text-sky-200" />
    case "DELIVERED":
      return <CheckCheck className="h-3.5 w-3.5 text-emerald-50/80" />
    case "FAILED":
      return <AlertCircle className="h-3.5 w-3.5 text-red-200" />
    default:
      return <Check className="h-3.5 w-3.5 text-emerald-50/80" />
  }
}

// Hover-only action strip next to a bubble: reply, react, forward.
function BubbleActions({
  m,
  reactionPickerFor,
  setReactionPickerFor,
  onReply,
  onReact,
  onForward,
}: {
  m: WhatsappChatMessage
  reactionPickerFor: string | null
  setReactionPickerFor: (id: string | null) => void
  onReply: (m: WhatsappChatMessage) => void
  onReact: (m: WhatsappChatMessage, emoji: string) => void
  onForward: (m: WhatsappChatMessage) => void
}) {
  const pickerOpen = reactionPickerFor === m.id
  return (
    <div className="relative flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
      <button
        type="button"
        onClick={() => onReply(m)}
        className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        aria-label="رد"
        title="رد"
      >
        <Reply className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setReactionPickerFor(pickerOpen ? null : m.id)}
        className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        aria-label="تفاعل"
        title="تفاعل"
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onForward(m)}
        className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
        aria-label="تحويل"
        title="تحويل"
      >
        <CornerUpRight className="h-3.5 w-3.5" />
      </button>
      {pickerOpen && (
        <div
          className="absolute bottom-full z-10 mb-1 flex items-center gap-0.5 whitespace-nowrap rounded-full border bg-white px-1.5 py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          style={{ borderColor: "var(--theme-cardBorder)" }}
        >
          {REACTION_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(m, m.reactionEmoji === e ? "" : e)
                setReactionPickerFor(null)
              }}
              className="rounded-full p-1 text-base transition hover:scale-125"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  m,
  grouped,
  highlighted,
  searchTerm,
  reactionPickerFor,
  setReactionPickerFor,
  onReply,
  onReact,
  onForward,
}: {
  m: WhatsappChatMessage
  grouped: boolean
  highlighted: boolean
  searchTerm: string
  reactionPickerFor: string | null
  setReactionPickerFor: (id: string | null) => void
  onReply: (m: WhatsappChatMessage) => void
  onReact: (m: WhatsappChatMessage, emoji: string) => void
  onForward: (m: WhatsappChatMessage) => void
}) {
  const isOut = m.direction === "OUT"
  const failed = isOut && m.status === "FAILED"
  const actions = (
    <BubbleActions
      m={m}
      reactionPickerFor={reactionPickerFor}
      setReactionPickerFor={setReactionPickerFor}
      onReply={onReply}
      onReact={onReact}
      onForward={onForward}
    />
  )
  return (
    <div id={`wa-msg-${m.id}`} className={cn("group flex w-full items-center gap-1", isOut ? "justify-end" : "justify-start")}>
      {isOut && actions}
      <div className="relative max-w-[70%]">
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-[13px] leading-relaxed shadow-sm transition",
            isOut
              ? failed
                ? cn("bg-red-500 text-white", grouped ? "rounded-tl-2xl" : "rounded-tl-sm")
                : cn("bg-emerald-500 text-white", grouped ? "rounded-tl-2xl" : "rounded-tl-sm")
              : cn(
                  "border bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100",
                  grouped ? "rounded-tr-2xl" : "rounded-tr-sm"
                ),
            highlighted && "ring-2 ring-amber-400"
          )}
        >
          {m.replyToText && (
            <div
              className={cn(
                "mb-1 rounded-md border-l-2 px-2 py-1 text-[11px] opacity-90",
                isOut ? "border-white/70 bg-white/10" : "border-emerald-500 bg-black/5 dark:bg-white/10"
              )}
            >
              <p className="line-clamp-2 whitespace-pre-wrap break-words">{m.replyToText}</p>
            </div>
          )}
          <MediaContent m={m} />
          <BubbleText m={m} searchTerm={searchTerm} />
          {failed && (
            <p className="mt-1 text-[11px] text-red-100">
              ✗ فشل الإرسال{m.statusError ? ` — ${m.statusError}` : ""}
            </p>
          )}
          <div className={cn("mt-1 flex items-center gap-1 text-[10px]", isOut ? "justify-end text-emerald-50/80" : "text-slate-400")}>
            <span>{bubbleTime(m.createdAt)}</span>
            {isOut && <StatusTicks m={m} />}
          </div>
        </div>
        {m.reactionEmoji && (
          <span
            className={cn(
              "absolute -bottom-2 flex h-5 min-w-[20px] items-center justify-center rounded-full border bg-white px-1 text-[11px] shadow dark:border-slate-600 dark:bg-slate-800",
              isOut ? "-left-1.5" : "-right-1.5"
            )}
          >
            {m.reactionEmoji}
          </span>
        )}
      </div>
      {!isOut && actions}
    </div>
  )
}

function QuickRepliesPopover({
  open,
  replies,
  currentText,
  newName,
  setNewName,
  onInsert,
  onAdd,
  onDelete,
}: {
  open: boolean
  replies: WhatsappQuickReply[]
  currentText: string
  newName: string
  setNewName: (v: string) => void
  onInsert: (body: string) => void
  onAdd: (name: string, body: string) => void
  onDelete: (id: string) => void
}) {
  if (!open) return null
  return (
    <div
      className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-lg border bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800"
      style={{ borderColor: "var(--theme-cardBorder)" }}
    >
      <p className="mb-1 px-1 text-[11px] font-semibold text-slate-400">ردود جاهزة</p>
      <div className="max-h-52 overflow-y-auto">
        {replies.length === 0 ? (
          <p className="px-1 py-3 text-center text-[11px] text-slate-400">لا توجد ردود جاهزة بعد</p>
        ) : (
          replies.map((r) => (
            <div key={r.id} className="group/item flex items-center gap-1 rounded-md px-1.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/50">
              <button type="button" onClick={() => onInsert(r.body)} className="min-w-0 flex-1 text-right">
                <p className="truncate text-[12px] font-semibold" style={{ color: "var(--theme-textPrimary)" }}>{r.name}</p>
                <p className="truncate text-[11px] text-slate-400">{r.body}</p>
              </button>
              <button
                type="button"
                onClick={() => onDelete(r.id)}
                className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition hover:text-red-500 group-hover/item:opacity-100"
                aria-label="حذف الرد الجاهز"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
      {currentText.trim() && (
        <div className="mt-1 flex items-center gap-1 border-t pt-2" style={{ borderColor: "var(--theme-cardBorder)" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="اسم الرد (لحفظ النص الحالي)"
            className="min-w-0 flex-1 rounded border px-2 py-1 text-[11px] focus:outline-none"
            style={{ borderColor: "var(--theme-cardBorder)", backgroundColor: "var(--theme-cardBg)", color: "var(--theme-textPrimary)" }}
          />
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={() => onAdd(newName.trim(), currentText.trim())}
            className="shrink-0 rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
          >
            حفظ
          </button>
        </div>
      )}
    </div>
  )
}

export function WhatsappChatPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const [search, setSearch] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [composeText, setComposeText] = useState("")
  const [olderMessages, setOlderMessages] = useState<WhatsappChatMessage[]>([])
  const [oldestHasMore, setOldestHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const threadRef = useRef<HTMLDivElement | null>(null)

  // Reply/quote
  const [replyTo, setReplyTo] = useState<WhatsappChatMessage | null>(null)
  // Reactions
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null)
  // In-conversation search
  const [threadSearchOpen, setThreadSearchOpen] = useState(false)
  const [threadSearchTerm, setThreadSearchTerm] = useState("")
  const [matchIndex, setMatchIndex] = useState(0)
  // Internal notes
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesDraft, setNotesDraft] = useState("")
  // Quick replies
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false)
  const [newQuickReplyName, setNewQuickReplyName] = useState("")
  // Forward
  const [forwardMessage, setForwardMessage] = useState<WhatsappChatMessage | null>(null)
  const [forwardSearch, setForwardSearch] = useState("")

  const conversationsQuery = useQuery({
    queryKey: ["whatsapp-conversations", search, showArchived],
    queryFn: () => getWhatsappConversations(search || undefined, showArchived),
    refetchInterval: 20_000,
    enabled: hasPermission("ACCESS_WHATSAPP_CHAT"),
  })
  const conversations = useMemo(() => {
    const rows = conversationsQuery.data ?? []
    return showArchived ? rows.filter((c) => c.isArchived) : rows
  }, [conversationsQuery.data, showArchived])

  const threadQuery = useQuery({
    queryKey: ["whatsapp-messages", selectedPhone],
    queryFn: () => getWhatsappMessages(selectedPhone as string),
    enabled: Boolean(selectedPhone) && hasPermission("ACCESS_WHATSAPP_CHAT"),
    refetchInterval: 15_000,
  })
  const latestWindow = threadQuery.data?.messages ?? []
  const messages = useMemo(() => [...olderMessages, ...latestWindow], [olderMessages, latestWindow])
  const activeConversation =
    conversations.find((c) => c.phone === selectedPhone) ?? threadQuery.data?.conversation ?? null

  const quickRepliesQuery = useQuery({
    queryKey: ["whatsapp-quick-replies"],
    queryFn: getWhatsappQuickReplies,
    enabled: hasPermission("ACCESS_WHATSAPP_CHAT"),
  })
  const quickReplies = quickRepliesQuery.data ?? []

  // Meta's 24h reply window — opens on the customer's LAST inbound message.
  const lastInboundAt = threadQuery.data?.lastInboundAt ?? null
  const windowClosed = Boolean(
    selectedPhone && threadQuery.data && (!lastInboundAt || Date.now() - new Date(lastInboundAt).getTime() > 24 * 60 * 60 * 1000)
  )

  // In-conversation search matches, computed over whatever's currently loaded.
  const matchIds = useMemo(() => {
    const term = threadSearchTerm.trim().toLowerCase()
    if (!term) return []
    return messages.filter((m) => m.text.toLowerCase().includes(term)).map((m) => m.id)
  }, [messages, threadSearchTerm])

  useEffect(() => {
    setMatchIndex(0)
  }, [threadSearchTerm, selectedPhone])

  useEffect(() => {
    if (!matchIds.length) return
    const target = matchIds[matchIndex] ?? matchIds[0]
    document.getElementById(`wa-msg-${target}`)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [matchIndex, matchIds])

  // Group messages by day + mark consecutive same-direction runs (<5min apart).
  const renderItems = useMemo(() => {
    type RenderItem =
      | { kind: "date"; label: string; key: string }
      | { kind: "msg"; m: WhatsappChatMessage; grouped: boolean; key: string }
    const items: RenderItem[] = []
    let prevDay = ""
    let prevMsg: WhatsappChatMessage | null = null
    for (const m of messages) {
      const day = new Date(m.createdAt).toDateString()
      if (day !== prevDay) {
        items.push({ kind: "date", label: dateSeparatorLabel(m.createdAt), key: `date-${day}` })
        prevDay = day
        prevMsg = null
      }
      const grouped = Boolean(
        prevMsg && prevMsg.direction === m.direction && new Date(m.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() < 5 * 60 * 1000
      )
      items.push({ kind: "msg", m, grouped, key: m.id })
      prevMsg = m
    }
    return items
  }, [messages])

  // Reset accumulated older pages + per-conversation UI state whenever the
  // open conversation changes, and pick up the initial page's hasMore flag.
  useEffect(() => {
    setOlderMessages([])
    setOldestHasMore(false)
    setAttachment(null)
    setReplyTo(null)
    setReactionPickerFor(null)
    setThreadSearchOpen(false)
    setThreadSearchTerm("")
    setNotesOpen(false)
    setQuickRepliesOpen(false)
    if (isRecording) cancelRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhone])
  useEffect(() => {
    if (olderMessages.length === 0) setOldestHasMore(threadQuery.data?.hasMore ?? false)
  }, [threadQuery.data?.hasMore, olderMessages.length])

  async function loadOlderMessages() {
    if (!selectedPhone || loadingOlder) return
    const oldest = messages[0]
    if (!oldest) return
    setLoadingOlder(true)
    const el = threadRef.current
    const distanceFromBottom = el ? el.scrollHeight - el.scrollTop : 0
    try {
      const page = await getWhatsappMessages(selectedPhone, { before: oldest.createdAt })
      setOlderMessages((prev) => [...page.messages, ...prev])
      setOldestHasMore(page.hasMore)
      // Keep the viewport anchored on the same message instead of jumping to top.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - distanceFromBottom
      })
    } finally {
      setLoadingOlder(false)
    }
  }

  const sendMutation = useMutation({
    mutationFn: ({ phone, text, replyToWaMessageId }: { phone: string; text: string; replyToWaMessageId?: string }) =>
      sendWhatsappChatMessage(phone, text, replyToWaMessageId),
    onSuccess: () => {
      setComposeText("")
      setReplyTo(null)
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] })
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] })
    },
    onError: () => {
      toast({ title: "تعذر إرسال الرسالة", variant: "destructive" })
    },
  })

  // Attachment picked/recorded but not sent yet — shown as a preview strip
  // above the composer; the text box doubles as its caption until إرسال.
  const [attachment, setAttachment] = useState<{ dataUrl: string; filename: string; mime: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const MAX_MEDIA_BYTES = 5 * 1024 * 1024

  function pickAttachment(file: File | undefined | null) {
    if (!file) return
    if (file.size > MAX_MEDIA_BYTES) {
      toast({ title: "حجم الملف أكبر من الحد المسموح (5MB)", variant: "destructive" })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setAttachment({ dataUrl: String(reader.result), filename: file.name, mime: file.type || "application/octet-stream" })
    reader.readAsDataURL(file)
  }

  // ── Voice recording (MediaRecorder) ──────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordDiscardedRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const recordTimerRef = useRef<number | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast({ title: "التسجيل الصوتي غير مدعوم بهذا المتصفح", variant: "destructive" })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus" : "audio/webm;codecs=opus"
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      recordedChunksRef.current = []
      recordDiscardedRef.current = false
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        if (recordDiscardedRef.current) {
          recordDiscardedRef.current = false
          return
        }
        const blob = new Blob(recordedChunksRef.current, { type: mime })
        if (!blob.size) return
        const reader = new FileReader()
        reader.onload = () =>
          setAttachment({ dataUrl: String(reader.result), filename: `voice-${Date.now()}.${mime.includes("ogg") ? "ogg" : "webm"}`, mime })
        reader.readAsDataURL(blob)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
      setRecordSeconds(0)
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000)
    } catch {
      toast({ title: "تعذر الوصول إلى المايكروفون", variant: "destructive" })
    }
  }

  function stopRecordingCommon() {
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
    setIsRecording(false)
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
  }
  function stopRecording() {
    stopRecordingCommon()
  }
  function cancelRecording() {
    recordDiscardedRef.current = true
    stopRecordingCommon()
  }

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const sendMediaMutation = useMutation({
    mutationFn: ({ phone, dataUrl, filename, caption }: { phone: string; dataUrl: string; filename: string; caption: string }) =>
      sendWhatsappChatMedia(phone, { dataUrl, filename, caption }),
    onSuccess: () => {
      setComposeText("")
      setAttachment(null)
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] })
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] })
    },
    onError: () => {
      toast({ title: "تعذر إرسال الملف", variant: "destructive" })
    },
  })

  const reactionMutation = useMutation({
    mutationFn: ({ phone, waMessageId, emoji }: { phone: string; waMessageId: string; emoji: string }) =>
      sendWhatsappChatReaction(phone, waMessageId, emoji),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] }),
    onError: () => toast({ title: "تعذر إضافة التفاعل", variant: "destructive" }),
  })

  const pinMutation = useMutation({
    mutationFn: ({ phone, isPinned }: { phone: string; isPinned: boolean }) => pinWhatsappConversation(phone, isPinned),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] }),
  })

  const archiveMutation = useMutation({
    mutationFn: ({ phone, isArchived }: { phone: string; isArchived: boolean }) => archiveWhatsappConversation(phone, isArchived),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] })
      if (vars.isArchived && selectedPhone === vars.phone) setSelectedPhone(null)
    },
  })

  const notesMutation = useMutation({
    mutationFn: ({ phone, notes }: { phone: string; notes: string }) => updateWhatsappConversationNotes(phone, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] })
      toast({ title: "تم حفظ الملاحظة" })
    },
    onError: () => toast({ title: "تعذر حفظ الملاحظة", variant: "destructive" }),
  })

  const addQuickReplyMutation = useMutation({
    mutationFn: ({ name, body }: { name: string; body: string }) => createWhatsappQuickReply(name, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-quick-replies"] })
      setNewQuickReplyName("")
    },
    onError: () => toast({ title: "تعذر حفظ الرد الجاهز", variant: "destructive" }),
  })

  const deleteQuickReplyMutation = useMutation({
    mutationFn: (id: string) => deleteWhatsappQuickReply(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-quick-replies"] }),
  })

  const forwardMutation = useMutation({
    mutationFn: async ({ targetPhone, message }: { targetPhone: string; message: WhatsappChatMessage }) => {
      if (message.mediaDataUrl) {
        return sendWhatsappChatMedia(targetPhone, {
          dataUrl: message.mediaDataUrl,
          filename: message.mediaFilename ?? undefined,
          caption: message.mediaType ? "" : message.text,
        })
      }
      return sendWhatsappChatMessage(targetPhone, message.text)
    },
    onSuccess: (_data, vars) => {
      toast({ title: "تم تحويل الرسالة" })
      setForwardMessage(null)
      setForwardSearch("")
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] })
      if (vars.targetPhone === selectedPhone) queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] })
    },
    onError: () => toast({ title: "تعذر تحويل الرسالة", variant: "destructive" }),
  })

  const markReadMutation = useMutation({
    mutationFn: (phone: string) => markWhatsappConversationRead(phone),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] }),
  })

  function openConversation(phone: string, unreadCount?: number) {
    setSelectedPhone(phone)
    if (unreadCount) markReadMutation.mutate(phone)
  }

  function openNotes() {
    setNotesDraft(activeConversation?.internalNotes ?? "")
    setNotesOpen(true)
  }

  function handleReply(m: WhatsappChatMessage) {
    if (!m.waMessageId) {
      toast({ title: "تعذر الرد على هذه الرسالة", variant: "destructive" })
      return
    }
    setReplyTo(m)
  }

  function handleReact(m: WhatsappChatMessage, emoji: string) {
    if (!selectedPhone || !m.waMessageId) {
      toast({ title: "تعذر إضافة التفاعل لهذه الرسالة", variant: "destructive" })
      return
    }
    reactionMutation.mutate({ phone: selectedPhone, waMessageId: m.waMessageId, emoji })
  }

  const MAX_MESSAGE_LENGTH = 4096
  function handleSend() {
    if (!selectedPhone || sendMutation.isPending || sendMediaMutation.isPending) return
    const text = composeText.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (attachment) {
      sendMediaMutation.mutate({ phone: selectedPhone, dataUrl: attachment.dataUrl, filename: attachment.filename, caption: text })
      return
    }
    if (!text) return
    sendMutation.mutate({ phone: selectedPhone, text, replyToWaMessageId: replyTo?.waMessageId ?? undefined })
  }

  // Auto-scroll to the newest message on open / when a new message lands at
  // the bottom — NOT when older pages get prepended (handled separately above).
  useEffect(() => {
    const el = threadRef.current
    if (el && olderMessages.length === 0) el.scrollTop = el.scrollHeight
  }, [latestWindow.length, selectedPhone, olderMessages.length])

  const exactMatchExists = useMemo(
    () => conversations.some((c) => c.phone.includes(search.replace(/\D/g, ""))),
    [conversations, search]
  )
  const showStartNew = !showArchived && search.trim().length > 0 && looksLikePhone(search) && !exactMatchExists

  if (!hasPermission("ACCESS_WHATSAPP_CHAT")) {
    return (
      <div dir="rtl" className="flex h-[calc(100vh-3.5rem)] w-full flex-col items-center justify-center gap-2 text-slate-400">
        <MessageCircle className="h-10 w-10" />
        <p className="text-sm font-semibold" style={{ color: "var(--theme-textPrimary)" }}>
          ما عندك صلاحية الوصول لمحادثات الواتساب
        </p>
        <p className="text-xs">اطلب من المدير يمنحك صلاحية «محادثات الواتساب» من صفحة المستخدمين</p>
      </div>
    )
  }

  return (
    <div dir="rtl" className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
      {/* Conversation list (right side in RTL) */}
      <div
        className="flex w-full max-w-xs shrink-0 flex-col border-l"
        style={{ borderColor: "var(--theme-cardBorder)", backgroundColor: "var(--theme-cardBg)" }}
      >
        <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: "var(--theme-cardBorder)" }}>
          <MessageCircle className="h-4 w-4 text-emerald-500" />
          <h1 className="text-sm font-bold" style={{ color: "var(--theme-textPrimary)" }}>
            محادثات الواتساب
          </h1>
        </div>

        <div className="border-b p-2" style={{ borderColor: "var(--theme-cardBorder)" }}>
          <div className="relative">
            <Search className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم أو الرقم..."
              className="pr-8 text-xs"
            />
          </div>
        </div>

        <div className="flex border-b text-[11px]" style={{ borderColor: "var(--theme-cardBorder)" }}>
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={cn(
              "flex-1 py-1.5 font-semibold transition",
              !showArchived ? "border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400" : "text-slate-400 hover:text-slate-600"
            )}
          >
            المحادثات
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={cn(
              "flex-1 py-1.5 font-semibold transition",
              showArchived ? "border-b-2 border-emerald-500 text-emerald-600 dark:text-emerald-400" : "text-slate-400 hover:text-slate-600"
            )}
          >
            المؤرشفة
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {showStartNew ? (
            <button
              type="button"
              onClick={() => {
                openConversation(search.replace(/\D/g, ""))
                setSearch("")
              }}
              className="flex w-full items-center gap-2 border-b px-3 py-3 text-right text-xs text-emerald-600 transition hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/20"
              style={{ borderColor: "var(--theme-cardBorder)" }}
            >
              <Send className="h-3.5 w-3.5 shrink-0" />
              ابدأ محادثة مع {search.trim()}
            </button>
          ) : null}

          {conversationsQuery.isLoading ? (
            <div className="p-6 text-center text-xs text-slate-400">جاري التحميل...</div>
          ) : conversations.length === 0 && !showStartNew ? (
            <div className="p-6 text-center text-xs text-slate-400">{showArchived ? "لا توجد محادثات مؤرشفة" : "لا توجد محادثات بعد"}</div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => openConversation(c.phone, c.unreadCount)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    openConversation(c.phone, c.unreadCount)
                  }
                }}
                className={cn(
                  "group flex w-full cursor-pointer items-start gap-2 border-b px-3 py-3 text-right transition hover:bg-slate-50 dark:hover:bg-slate-800/60",
                  selectedPhone === c.phone && "bg-slate-100 dark:bg-slate-800"
                )}
                style={{ borderColor: "var(--theme-cardBorder)" }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                  {(c.contactName ?? c.phone).charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex min-w-0 items-center gap-1 truncate text-[13px] font-semibold" style={{ color: "var(--theme-textPrimary)" }}>
                      {c.isPinned ? <Pin className="h-3 w-3 shrink-0 fill-current text-emerald-500" /> : null}
                      <span className="truncate">{c.contactName ?? c.phone}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {c.lastDirection === "OUT" ? "أنت: " : ""}
                      {c.lastMessageText ?? ""}
                    </span>
                    {c.unreadCount > 0 ? (
                      <span className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      pinMutation.mutate({ phone: c.phone, isPinned: !c.isPinned })
                    }}
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
                    title={c.isPinned ? "إلغاء التثبيت" : "تثبيت"}
                    aria-label={c.isPinned ? "إلغاء التثبيت" : "تثبيت"}
                  >
                    <Pin className={cn("h-3.5 w-3.5", c.isPinned && "fill-current text-emerald-500")} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      archiveMutation.mutate({ phone: c.phone, isArchived: !c.isArchived })
                    }}
                    className="rounded p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700"
                    title={c.isArchived ? "استعادة" : "أرشفة"}
                    aria-label={c.isArchived ? "استعادة" : "أرشفة"}
                  >
                    {c.isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Thread pane (left side in RTL) */}
      <div className="flex flex-1 flex-col" style={{ backgroundColor: "var(--theme-bg)" }}>
        {!selectedPhone ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <MessageCircle className="h-10 w-10" />
            <p className="text-sm">اختر محادثة أو ابدأ محادثة جديدة</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b p-3" style={{ borderColor: "var(--theme-cardBorder)" }}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                {(activeConversation?.contactName ?? selectedPhone).charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold" style={{ color: "var(--theme-textPrimary)" }}>
                  {activeConversation?.contactName ?? selectedPhone}
                </div>
                <div className="truncate text-[11px] text-slate-400">{selectedPhone}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {activeConversation?.customerId && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(`/customers/${activeConversation.customerId}`)}
                      className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                      title="فتح حساب الزبون"
                      aria-label="فتح حساب الزبون"
                    >
                      <User className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/invoices/new?type=SALE&customerId=${activeConversation.customerId}`)}
                      className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                      title="فاتورة جديدة لهذا الزبون"
                      aria-label="فاتورة جديدة لهذا الزبون"
                    >
                      <Receipt className="h-4 w-4" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setThreadSearchOpen((o) => !o)}
                  className={cn(
                    "rounded-full p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800",
                    threadSearchOpen ? "text-emerald-500" : "text-slate-400 hover:text-slate-600"
                  )}
                  title="بحث بالمحادثة"
                  aria-label="بحث بالمحادثة"
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => (notesOpen ? setNotesOpen(false) : openNotes())}
                  className={cn(
                    "rounded-full p-1.5 transition hover:bg-slate-100 dark:hover:bg-slate-800",
                    notesOpen ? "text-emerald-500" : "text-slate-400 hover:text-slate-600"
                  )}
                  title="ملاحظة داخلية"
                  aria-label="ملاحظة داخلية"
                >
                  <StickyNote className="h-4 w-4" />
                </button>
              </div>
            </div>

            {threadSearchOpen && (
              <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--theme-cardBorder)" }}>
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={threadSearchTerm}
                  onChange={(e) => setThreadSearchTerm(e.target.value)}
                  placeholder="ابحث داخل هذه المحادثة..."
                  className="flex-1 bg-transparent text-[12px] focus:outline-none"
                  style={{ color: "var(--theme-textPrimary)" }}
                />
                {threadSearchTerm.trim() && (
                  <span className="shrink-0 text-[11px] text-slate-400">{matchIds.length ? `${matchIndex + 1} / ${matchIds.length}` : "لا نتائج"}</span>
                )}
                <button
                  type="button"
                  disabled={!matchIds.length}
                  onClick={() => setMatchIndex((i) => (i - 1 + matchIds.length) % matchIds.length)}
                  className="rounded p-1 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                  aria-label="النتيجة السابقة"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={!matchIds.length}
                  onClick={() => setMatchIndex((i) => (i + 1) % matchIds.length)}
                  className="rounded p-1 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                  aria-label="النتيجة التالية"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setThreadSearchOpen(false)
                    setThreadSearchTerm("")
                  }}
                  className="rounded p-1 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="إغلاق البحث"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {notesOpen && (
              <div className="border-b p-3" style={{ borderColor: "var(--theme-cardBorder)" }}>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-slate-400">ملاحظة داخلية (لا تُرسل للزبون)</p>
                  <button type="button" onClick={() => setNotesOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="إغلاق الملاحظات">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  dir="auto"
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={2}
                  placeholder="اكتب ملاحظة عن هذا الزبون أو المحادثة..."
                  className="w-full resize-none rounded-md border px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  style={{ borderColor: "var(--theme-cardBorder)", backgroundColor: "var(--theme-cardBg)", color: "var(--theme-textPrimary)" }}
                />
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => selectedPhone && notesMutation.mutate({ phone: selectedPhone, notes: notesDraft })}
                    disabled={notesMutation.isPending}
                    className="rounded-md bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    حفظ الملاحظة
                  </button>
                </div>
              </div>
            )}

            <div ref={threadRef} dir="ltr" className="flex-1 overflow-y-auto p-4">
              {threadQuery.isLoading ? (
                <div className="text-center text-xs text-slate-400">جاري التحميل...</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-xs text-slate-400">لا توجد رسائل بعد — ابدأ المحادثة بالأسفل</div>
              ) : (
                <>
                  {oldestHasMore ? (
                    <div className="flex justify-center pb-2">
                      <button
                        type="button"
                        onClick={loadOlderMessages}
                        disabled={loadingOlder}
                        className="flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
                        style={{ borderColor: "var(--theme-cardBorder)" }}
                      >
                        <ChevronUp className="h-3 w-3" />
                        {loadingOlder ? "جاري التحميل..." : "تحميل رسائل أقدم"}
                      </button>
                    </div>
                  ) : null}
                  {renderItems.map((item, idx) => (
                    <div key={item.key} className={idx === 0 ? "" : item.kind === "date" ? "mt-3" : item.grouped ? "mt-0.5" : "mt-2"}>
                      {item.kind === "date" ? (
                        <div className="flex justify-center py-1">
                          <span className="rounded-full bg-slate-200/70 px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:bg-slate-700/60 dark:text-slate-300">
                            {item.label}
                          </span>
                        </div>
                      ) : (
                        <MessageBubble
                          m={item.m}
                          grouped={item.grouped}
                          highlighted={matchIds.length > 0 && matchIds[matchIndex] === item.m.id}
                          searchTerm={threadSearchTerm}
                          reactionPickerFor={reactionPickerFor}
                          setReactionPickerFor={setReactionPickerFor}
                          onReply={handleReply}
                          onReact={handleReact}
                          onForward={setForwardMessage}
                        />
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>

            {windowClosed && (
              <div className="flex items-center gap-2 border-t bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700 dark:bg-amber-950 dark:text-amber-300" style={{ borderColor: "var(--theme-cardBorder)" }}>
                ⏱ مضت أكثر من 24 ساعة على آخر رسالة من الزبون — واتساب قد يرفض الرسائل الحرة حتى يراسلك من جديد (الرسالة المرفوضة تظهر حمراء مع السبب).
              </div>
            )}
            {replyTo && (
              <div className="flex items-center gap-2 border-t px-3 py-2" style={{ borderColor: "var(--theme-cardBorder)" }}>
                <Reply className="h-4 w-4 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1 border-l-2 border-emerald-500 pl-2">
                  <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    {replyTo.direction === "OUT" ? "أنت" : activeConversation?.contactName ?? selectedPhone}
                  </p>
                  <p className="truncate text-[12px]" style={{ color: "var(--theme-textPrimary)" }}>
                    {replyTo.mediaType ? mediaFallback(replyTo.mediaType, replyTo.mediaFilename) : replyTo.text}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="rounded-full px-2 py-1 text-[11px] text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950"
                >
                  إلغاء
                </button>
              </div>
            )}
            {attachment && (
              <div className="flex items-center gap-2 border-t px-3 py-2" style={{ borderColor: "var(--theme-cardBorder)" }}>
                {attachment.mime.startsWith("image/") ? (
                  <img src={attachment.dataUrl} alt={attachment.filename} className="h-14 w-14 rounded-lg object-cover" />
                ) : attachment.mime.startsWith("audio/") ? (
                  <audio src={attachment.dataUrl} controls className="h-9 max-w-[190px]" />
                ) : (
                  <FileText className="h-8 w-8 text-slate-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px]" style={{ color: "var(--theme-textPrimary)" }}>
                    {attachment.mime.startsWith("audio/") ? "رسالة صوتية" : attachment.filename}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {attachment.mime.startsWith("audio/") ? "اضغط إرسال لإرسال الرسالة الصوتية" : "اكتب تعليقاً (اختياري) ثم اضغط إرسال"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="rounded-full px-2 py-1 text-[11px] text-red-500 transition hover:bg-red-50 dark:hover:bg-red-950"
                >
                  إلغاء
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 border-t p-3" style={{ borderColor: "var(--theme-cardBorder)" }}>
              {isRecording ? (
                <div className="flex flex-1 items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--theme-cardBorder)" }}>
                  <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                  <span className="text-[12px] text-slate-500">
                    {Math.floor(recordSeconds / 60)}:{String(recordSeconds % 60).padStart(2, "0")} جاري التسجيل...
                  </span>
                  <button
                    type="button"
                    onClick={cancelRecording}
                    className="mr-auto rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label="إلغاء التسجيل"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                    aria-label="إيقاف التسجيل وإرفاقها"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                    className="hidden"
                    onChange={(e) => {
                      pickAttachment(e.target.files?.[0])
                      e.target.value = ""
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                    aria-label="إرفاق ملف"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setQuickRepliesOpen((o) => !o)}
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-slate-100 dark:hover:bg-slate-800",
                        quickRepliesOpen ? "text-emerald-500" : "text-slate-400 hover:text-slate-600"
                      )}
                      aria-label="ردود جاهزة"
                      title="ردود جاهزة"
                    >
                      <Zap className="h-4 w-4" />
                    </button>
                    <QuickRepliesPopover
                      open={quickRepliesOpen}
                      replies={quickReplies}
                      currentText={composeText}
                      newName={newQuickReplyName}
                      setNewName={setNewQuickReplyName}
                      onInsert={(body) => {
                        setComposeText(body)
                        setQuickRepliesOpen(false)
                      }}
                      onAdd={(name, body) => addQuickReplyMutation.mutate({ name, body })}
                      onDelete={(id) => deleteQuickReplyMutation.mutate(id)}
                    />
                  </div>
                  <textarea
                    dir="auto"
                    value={composeText}
                    onChange={(e) => setComposeText(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder="اكتب رسالة..."
                    rows={1}
                    maxLength={MAX_MESSAGE_LENGTH}
                    className="flex-1 resize-none rounded-lg border px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    style={{ borderColor: "var(--theme-cardBorder)", backgroundColor: "var(--theme-cardBg)", color: "var(--theme-textPrimary)" }}
                  />
                  {!composeText.trim() && !attachment ? (
                    <button
                      type="button"
                      onClick={startRecording}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                      aria-label="تسجيل رسالة صوتية"
                    >
                      <Mic className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={sendMutation.isPending || sendMediaMutation.isPending}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:opacity-40"
                      aria-label="إرسال"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog open={Boolean(forwardMessage)} onOpenChange={(o) => { if (!o) { setForwardMessage(null); setForwardSearch("") } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تحويل الرسالة</DialogTitle>
            <DialogDescription>اختر المحادثة التي تريد تحويل الرسالة إليها</DialogDescription>
          </DialogHeader>
          {forwardMessage && (
            <div className="mb-3 rounded-lg border-l-4 border-emerald-500 bg-slate-50 px-3 py-2 text-[12px] dark:bg-slate-800" style={{ color: "var(--theme-textPrimary)" }}>
              {forwardMessage.mediaType ? mediaFallback(forwardMessage.mediaType, forwardMessage.mediaFilename) : forwardMessage.text}
            </div>
          )}
          <Input value={forwardSearch} onChange={(e) => setForwardSearch(e.target.value)} placeholder="ابحث بالاسم أو الرقم..." className="mb-2 text-xs" />
          <div className="max-h-64 overflow-y-auto">
            {conversations
              .filter((c) => c.phone !== selectedPhone)
              .filter(
                (c) =>
                  !forwardSearch.trim() ||
                  (c.contactName ?? c.phone).toLowerCase().includes(forwardSearch.trim().toLowerCase()) ||
                  c.phone.includes(forwardSearch.replace(/\D/g, ""))
              )
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={forwardMutation.isPending}
                  onClick={() => forwardMessage && forwardMutation.mutate({ targetPhone: c.phone, message: forwardMessage })}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-right transition hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                    {(c.contactName ?? c.phone).charAt(0)}
                  </div>
                  <span className="truncate text-[13px]" style={{ color: "var(--theme-textPrimary)" }}>
                    {c.contactName ?? c.phone}
                  </span>
                </button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
