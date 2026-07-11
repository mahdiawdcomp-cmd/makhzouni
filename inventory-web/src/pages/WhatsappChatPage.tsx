import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Check, CheckCheck, ChevronUp, FileText, MessageCircle, Paperclip, Search, Send } from "lucide-react"
import {
  getWhatsappConversations,
  getWhatsappMessages,
  markWhatsappConversationRead,
  sendWhatsappChatMedia,
  sendWhatsappChatMessage,
} from "../api/endpoints"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import { useAuthStore } from "../store/authStore"
import { cn } from "../utils/cn"
import type { WhatsappChatMessage } from "../types/api"

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

function BubbleText({ m }: { m: WhatsappChatMessage }) {
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
      {m.text}
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

function MessageBubble({ m }: { m: WhatsappChatMessage }) {
  const isOut = m.direction === "OUT"
  const failed = isOut && m.status === "FAILED"
  return (
    <div className={cn("flex w-full", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed shadow-sm",
          isOut
            ? failed
              ? "rounded-tl-sm bg-red-500 text-white"
              : "rounded-tl-sm bg-emerald-500 text-white"
            : "rounded-tr-sm border bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        )}
      >
        <MediaContent m={m} />
        <BubbleText m={m} />
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
    </div>
  )
}

export function WhatsappChatPage() {
  const queryClient = useQueryClient()
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const [search, setSearch] = useState("")
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [composeText, setComposeText] = useState("")
  const [olderMessages, setOlderMessages] = useState<WhatsappChatMessage[]>([])
  const [oldestHasMore, setOldestHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const threadRef = useRef<HTMLDivElement | null>(null)

  const conversationsQuery = useQuery({
    queryKey: ["whatsapp-conversations", search],
    queryFn: () => getWhatsappConversations(search || undefined),
    refetchInterval: 20_000,
    enabled: hasPermission("ACCESS_WHATSAPP_CHAT"),
  })
  const conversations = conversationsQuery.data ?? []

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

  // Meta's 24h reply window — opens on the customer's LAST inbound message.
  const lastInboundAt = threadQuery.data?.lastInboundAt ?? null
  const windowClosed = Boolean(
    selectedPhone && threadQuery.data && (!lastInboundAt || Date.now() - new Date(lastInboundAt).getTime() > 24 * 60 * 60 * 1000)
  )

  // Reset accumulated older pages whenever the open conversation changes, and
  // pick up the initial page's hasMore flag as the starting point.
  useEffect(() => {
    setOlderMessages([])
    setOldestHasMore(false)
    setAttachment(null)
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
    mutationFn: ({ phone, text }: { phone: string; text: string }) => sendWhatsappChatMessage(phone, text),
    onSuccess: () => {
      setComposeText("")
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] })
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] })
    },
    onError: () => {
      toast({ title: "تعذر إرسال الرسالة", variant: "destructive" })
    },
  })

  // Attachment picked but not sent yet — shown as a preview strip above the
  // composer; the text box doubles as its caption until إرسال.
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

  const markReadMutation = useMutation({
    mutationFn: (phone: string) => markWhatsappConversationRead(phone),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] }),
  })

  function openConversation(phone: string, unreadCount?: number) {
    setSelectedPhone(phone)
    if (unreadCount) markReadMutation.mutate(phone)
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
    sendMutation.mutate({ phone: selectedPhone, text })
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
  const showStartNew = search.trim().length > 0 && looksLikePhone(search) && !exactMatchExists

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
            <div className="p-6 text-center text-xs text-slate-400">لا توجد محادثات بعد</div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openConversation(c.phone, c.unreadCount)}
                className={cn(
                  "flex w-full items-start gap-2 border-b px-3 py-3 text-right transition hover:bg-slate-50 dark:hover:bg-slate-800/60",
                  selectedPhone === c.phone && "bg-slate-100 dark:bg-slate-800"
                )}
                style={{ borderColor: "var(--theme-cardBorder)" }}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                  {(c.contactName ?? c.phone).charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[13px] font-semibold" style={{ color: "var(--theme-textPrimary)" }}>
                      {c.contactName ?? c.phone}
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
              </button>
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
            </div>

            <div ref={threadRef} dir="ltr" className="flex-1 space-y-1.5 overflow-y-auto p-4">
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
                  {messages.map((m) => (
                    <MessageBubble key={m.id} m={m} />
                  ))}
                </>
              )}
            </div>

            {windowClosed && (
              <div className="flex items-center gap-2 border-t bg-amber-50 px-3 py-2 text-[11.5px] text-amber-700 dark:bg-amber-950 dark:text-amber-300" style={{ borderColor: "var(--theme-cardBorder)" }}>
                ⏱ مضت أكثر من 24 ساعة على آخر رسالة من الزبون — واتساب قد يرفض الرسائل الحرة حتى يراسلك من جديد (الرسالة المرفوضة تظهر حمراء مع السبب).
              </div>
            )}
            {attachment && (
              <div className="flex items-center gap-2 border-t px-3 py-2" style={{ borderColor: "var(--theme-cardBorder)" }}>
                {attachment.mime.startsWith("image/") ? (
                  <img src={attachment.dataUrl} alt={attachment.filename} className="h-14 w-14 rounded-lg object-cover" />
                ) : (
                  <FileText className="h-8 w-8 text-slate-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px]" style={{ color: "var(--theme-textPrimary)" }}>{attachment.filename}</p>
                  <p className="text-[11px] text-slate-400">اكتب تعليقاً (اختياري) ثم اضغط إرسال</p>
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
              <button
                type="button"
                onClick={handleSend}
                disabled={(!composeText.trim() && !attachment) || sendMutation.isPending || sendMediaMutation.isPending}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white transition hover:bg-emerald-600 disabled:opacity-40"
                aria-label="إرسال"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
