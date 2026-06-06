import { useRef, useState } from "react"
import {
  Bot, Mic, MicOff, Loader2, Volume2, VolumeX, X, RotateCcw,
} from "lucide-react"
import { api } from "../../api/client"
import { cn } from "../../utils/cn"

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentStatus = "idle" | "listening" | "thinking" | "speaking" | "error"

interface HistoryItem {
  role: "user" | "assistant"
  content: string
}

interface AgentResponse {
  success: boolean
  reply: string
  history: HistoryItem[]
}

type SpeechRecognitionLike = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  start: () => void; stop: () => void
  onstart: (() => void) | null
  onresult: ((e: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

// ── TTS Helper ─────────────────────────────────────────────────────────────────

function speak(text: string, onEnd?: () => void) {
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  // نحاول العربي أولاً — إذا ما وجد يستخدم الافتراضي
  const voices = window.speechSynthesis.getVoices()
  const arabicVoice = voices.find(
    (v) => v.lang.startsWith("ar") || v.name.toLowerCase().includes("arab")
  )
  if (arabicVoice) utterance.voice = arabicVoice
  utterance.lang  = "ar-SA"
  utterance.rate  = 1.05
  utterance.pitch = 1
  if (onEnd) utterance.onend = onEnd
  window.speechSynthesis.speak(utterance)
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AgentButton() {
  const [open, setOpen]         = useState(false)
  const [status, setStatus]     = useState<AgentStatus>("idle")
  const [history, setHistory]   = useState<HistoryItem[]>([])
  const [lastReply, setLastReply] = useState("")
  const [muted, setMuted]       = useState(false)
  const [errorText, setErrorText] = useState("")
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const chatRef        = useRef<HTMLDivElement>(null)

  // ── إرسال للـ Agent ────────────────────────────────────────────────────────
  async function sendMessage(text: string) {
    setStatus("thinking")
    const userItem: HistoryItem = { role: "user", content: text }
    setHistory((h) => [...h, userItem])

    try {
      const { data } = await api.post<AgentResponse>("/agent/chat", {
        message: text,
        history: history.slice(-6),
      })

      const reply = data.reply
      setLastReply(reply)
      setHistory(data.history)

      if (!muted) {
        setStatus("speaking")
        speak(reply, () => setStatus("idle"))
      } else {
        setStatus("idle")
      }

      // scroll للأسفل
      setTimeout(() => {
        chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" })
      }, 100)

    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })
          ?.response?.data?.message ?? "تعذر الاتصال"
      setErrorText(msg)
      setStatus("error")
    }
  }

  // ── تشغيل الميكروفون ───────────────────────────────────────────────────────
  function startListening() {
    const API =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition

    if (!API) {
      setErrorText("المتصفح لا يدعم الصوت — جرب Chrome")
      setStatus("error")
      return
    }

    const rec = new API()
    rec.lang            = "ar-IQ"
    rec.continuous      = false
    rec.interimResults  = false
    rec.maxAlternatives = 1

    rec.onstart  = () => setStatus("listening")
    rec.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript ?? ""
      if (text.trim()) void sendMessage(text.trim())
      else { setStatus("idle") }
    }
    rec.onerror  = () => {
      setErrorText("ما سمعت شيء — حاول مرة ثانية")
      setStatus("error")
    }
    rec.onend = () => setStatus((s) => s === "listening" ? "idle" : s)

    recognitionRef.current = rec
    window.speechSynthesis.cancel()
    rec.start()
  }

  function stopListening() {
    recognitionRef.current?.stop()
    setStatus("idle")
  }

  function resetConversation() {
    setHistory([])
    setLastReply("")
    setStatus("idle")
    window.speechSynthesis.cancel()
  }

  // ── ألوان ─────────────────────────────────────────────────────────────────
  const statusColors: Record<AgentStatus, string> = {
    idle:      "bg-violet-600 hover:bg-violet-700",
    listening: "bg-red-500 animate-pulse",
    thinking:  "bg-amber-500",
    speaking:  "bg-emerald-500 animate-pulse",
    error:     "bg-rose-600",
  }

  const statusLabel: Record<AgentStatus, string> = {
    idle:      "اسأل المساعد",
    listening: "تكلم الآن...",
    thinking:  "يفكر...",
    speaking:  "يتكلم...",
    error:     errorText,
  }

  return (
    <>
      {/* ── زر الفتح ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 left-6 z-40",
          "flex h-14 w-14 items-center justify-center rounded-full shadow-2xl",
          "bg-violet-600 text-white hover:bg-violet-700 hover:scale-110",
          "transition-all duration-200",
        )}
        title="المساعد الذكي"
      >
        <Bot className="h-7 w-7" />
      </button>

      {/* ── نافذة المساعد ── */}
      {open && (
        <div className="fixed bottom-24 left-6 z-50 w-80 flex flex-col rounded-2xl
                        border border-slate-200 bg-white shadow-2xl
                        dark:border-slate-700 dark:bg-slate-900"
          style={{ maxHeight: "70vh" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between rounded-t-2xl
                          bg-violet-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <span className="font-semibold text-sm">مساعد مخزوني</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setMuted(!muted)}
                className="rounded-full p-1 hover:bg-white/20 transition">
                {muted
                  ? <VolumeX className="h-4 w-4" />
                  : <Volume2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={resetConversation}
                className="rounded-full p-1 hover:bg-white/20 transition"
                title="محادثة جديدة">
                <RotateCcw className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => { setOpen(false); window.speechSynthesis.cancel() }}
                className="rounded-full p-1 hover:bg-white/20 transition">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Chat history */}
          <div ref={chatRef}
            className="flex-1 overflow-y-auto p-3 space-y-2"
            style={{ minHeight: 200, maxHeight: 360 }}>

            {history.length === 0 && (
              <div className="text-center text-xs text-slate-400 py-8 space-y-1">
                <Bot className="h-8 w-8 mx-auto text-violet-300" />
                <p>اسألني عن رصيد زبون، مبيعات اليوم،</p>
                <p>مخزون منتج، أو قول لي سوّي فاتورة</p>
              </div>
            )}

            {history.map((item, i) => (
              <div key={i} className={cn(
                "flex",
                item.role === "user" ? "justify-start" : "justify-end"
              )}>
                <div className={cn(
                  "rounded-xl px-3 py-2 text-sm max-w-[85%] leading-relaxed",
                  item.role === "user"
                    ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
                    : "bg-violet-600 text-white"
                )}>
                  {item.content}
                </div>
              </div>
            ))}

            {status === "thinking" && (
              <div className="flex justify-end">
                <div className="rounded-xl bg-violet-100 px-3 py-2 dark:bg-violet-900/30">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className={cn(
            "px-3 py-1.5 text-xs text-center font-medium transition-all",
            status === "listening" && "bg-red-50 text-red-600 dark:bg-red-950/30",
            status === "thinking"  && "bg-amber-50 text-amber-600 dark:bg-amber-950/30",
            status === "speaking"  && "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30",
            status === "error"     && "bg-rose-50 text-rose-600 dark:bg-rose-950/30",
            status === "idle"      && "hidden",
          )}>
            {statusLabel[status]}
          </div>

          {/* Mic button */}
          <div className="border-t border-slate-100 p-3 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                if (status === "listening") stopListening()
                else if (status === "speaking") { window.speechSynthesis.cancel(); setStatus("idle") }
                else void startListening()
              }}
              disabled={status === "thinking"}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-xl py-3",
                "text-white font-medium text-sm transition-all",
                statusColors[status],
                status === "thinking" && "cursor-not-allowed opacity-70",
              )}
            >
              {status === "listening" ? (
                <><MicOff className="h-4 w-4" /> إيقاف</>
              ) : status === "thinking" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> يفكر...</>
              ) : status === "speaking" ? (
                <><Volume2 className="h-4 w-4" /> اضغط لإيقاف الصوت</>
              ) : (
                <><Mic className="h-4 w-4" /> اضغط وتكلم</>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
