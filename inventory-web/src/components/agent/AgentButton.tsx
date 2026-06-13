import { useEffect, useRef, useState } from "react"
import { Bot, Mic, MicOff, RotateCcw, Volume2, VolumeX, X } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../ui/button"

type AgentStatus = "idle" | "listening" | "thinking" | "speaking" | "error"
type AgentMessage = { role: "user" | "assistant"; content: string }
type AgentResponse = { success: boolean; reply?: string; history?: AgentMessage[] }
type SpeechRecognitionEventLike = { results: { [index: number]: { [index: number]: { transcript: string } } } }
type SpeechRecognitionErrorEventLike = { error?: string }
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function speechCtor() {
  const source = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return source.SpeechRecognition ?? source.webkitSpeechRecognition
}

function speak(text: string, muted: boolean, onEnd: () => void) {
  if (muted || !("speechSynthesis" in window)) {
    onEnd()
    return
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const arabicVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.startsWith("ar"))
  if (arabicVoice) utterance.voice = arabicVoice
  utterance.lang = "ar-SA"
  utterance.rate = 1.05
  utterance.onend = onEnd
  utterance.onerror = onEnd
  window.speechSynthesis.speak(utterance)
}

export function AgentButton() {
  const [open, setOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [status, setStatus] = useState<AgentStatus>("idle")
  const [error, setError] = useState("")
  const [history, setHistory] = useState<AgentMessage[]>([])
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
  }, [history, open])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      window.speechSynthesis?.cancel()
    }
  }, [])

  async function sendMessage(text: string) {
    const userMessage: AgentMessage = { role: "user", content: text }
    const requestHistory = history.slice(-6)
    setHistory((prev) => [...prev, userMessage])
    setStatus("thinking")
    setError("")
    try {
      const { data } = await api.post<AgentResponse>("/agent/chat", { message: text, history: requestHistory })
      const reply = data.reply?.trim() || "ما قدرت أجاوب هسه."
      const fallbackHistory: AgentMessage[] = [...requestHistory, userMessage, { role: "assistant", content: reply }]
      setHistory(data.history?.length ? data.history : fallbackHistory)
      setStatus("speaking")
      speak(reply, muted, () => setStatus("idle"))
    } catch (sendError) {
      const responseMessage = (sendError as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(responseMessage || (sendError instanceof Error ? sendError.message : "تعذر الاتصال بالمساعد"))
      setStatus("error")
    }
  }

  function startListening() {
    const Recognition = speechCtor()
    if (!Recognition) {
      setError("المتصفح ما يدعم المايكروفون الصوتي. جرّب Chrome.")
      setStatus("error")
      return
    }
    window.speechSynthesis?.cancel()
    recognitionRef.current?.abort()
    const recognition = new Recognition()
    recognition.lang = "ar-IQ"
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim()
      if (text) void sendMessage(text)
      else setStatus("idle")
    }
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "اسمح للمايكروفون من المتصفح." : "ما قدرت أسمع، حاول مرة ثانية.")
      setStatus("error")
    }
    recognition.onend = () => setStatus((current) => current === "listening" ? "idle" : current)
    recognitionRef.current = recognition
    setStatus("listening")
    recognition.start()
  }

  function handleMic() {
    if (status === "thinking") return
    if (status === "listening") {
      recognitionRef.current?.abort()
      setStatus("idle")
      return
    }
    if (status === "speaking") {
      window.speechSynthesis?.cancel()
      setStatus("idle")
      startListening()
      return
    }
    startListening()
  }

  function reset() {
    window.speechSynthesis?.cancel()
    recognitionRef.current?.abort()
    setHistory([])
    setError("")
    setStatus("idle")
  }

  const [textInput, setTextInput] = useState("")

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault()
    const t = textInput.trim()
    if (!t || status === "thinking") return
    setTextInput("")
    void sendMessage(t)
  }

  const statusText =
    status === "listening" ? "تكلم الآن..." :
    status === "thinking" ? "يفكر..." :
    status === "speaking" ? "يتكلم..." :
    status === "error" ? error :
    ""

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 left-5 z-40 grid h-14 w-14 place-items-center rounded-full bg-violet-600 text-white shadow-xl shadow-violet-900/20 transition hover:bg-violet-700" title="المساعد الذكي">
        <Bot className="h-7 w-7" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-start bg-black/30 p-3 sm:p-5">
          <div className="flex h-[min(680px,92vh)] w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-slate-950">
            <div className="flex items-center justify-between bg-violet-700 px-4 py-3 text-white">
              <div className="flex items-center gap-2 font-bold"><Bot className="h-5 w-5" /> المساعد الذكي</div>
              <div className="flex items-center gap-1">
                <button type="button" className="rounded-md p-1.5 hover:bg-white/10" onClick={() => setMuted((value) => !value)} title={muted ? "تشغيل الصوت" : "كتم الصوت"}>{muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}</button>
                <button type="button" className="rounded-md p-1.5 hover:bg-white/10" onClick={reset} title="محادثة جديدة"><RotateCcw className="h-4 w-4" /></button>
                <button type="button" className="rounded-md p-1.5 hover:bg-white/10" onClick={() => setOpen(false)} title="إغلاق"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-900">
              {history.length === 0 ? (
                <div className="space-y-2 text-sm text-slate-500">
                  {["وين رصيد أبو محمد؟", "شنو مبيعات اليوم؟", "سوي فاتورة لعلي كارتون شاي", "شنو المواد الناقصة؟"].map((hint) => (
                    <button
                      key={hint}
                      type="button"
                      onClick={() => { void sendMessage(hint) }}
                      className="w-full rounded-md border bg-white px-3 py-2 text-right text-slate-700 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-violet-950/30"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
              ) : null}
              {history.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`flex ${message.role === "assistant" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] rounded-lg px-3 py-2 text-sm leading-6 ${message.role === "assistant" ? "bg-violet-600 text-white" : "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"}`}>{message.content}</div>
                </div>
              ))}
              {status === "thinking" && (
                <div className="flex justify-end">
                  <div className="flex items-center gap-1 rounded-lg bg-violet-100 px-3 py-2 dark:bg-violet-950/40">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-2 w-2 animate-bounce rounded-full bg-violet-500" style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t bg-white dark:border-slate-800 dark:bg-slate-950">
              {statusText && status !== "thinking" ? (
                <div className={`px-4 pt-2 text-center text-xs font-semibold ${status === "error" ? "text-rose-600" : status === "listening" ? "text-rose-500" : status === "speaking" ? "text-emerald-600" : "text-slate-500"}`}>
                  {statusText}
                </div>
              ) : null}
              <form onSubmit={handleTextSubmit} className="flex items-center gap-2 p-3">
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="اكتب سؤالك هنا..."
                  disabled={status === "thinking"}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-right outline-none focus:border-violet-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={!textInput.trim() || status === "thinking"}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
                  title="أرسل"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 rotate-90"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                </button>
                <Button
                  type="button"
                  className={`h-9 w-9 shrink-0 rounded-lg p-0 ${status === "listening" ? "animate-pulse bg-rose-600 hover:bg-rose-700" : status === "speaking" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-violet-600 hover:bg-violet-700"}`}
                  disabled={status === "thinking"}
                  onClick={handleMic}
                  title="تكلم"
                >
                  {status === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
