import { useEffect, useRef, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import {
  Bot,
  Check,
  Loader2,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react"
import { api } from "../../api/client"
import { cn } from "../../utils/cn"

type Role = "user" | "assistant"

interface ChatMessage {
  id: string
  role: Role
  text: string
}

interface VoicePlanItem {
  productId: string
  productName: string
  quantity: number
  unit: "PIECE" | "DOZEN" | "CARTON"
  unitPrice: number
  totalPrice: number
  warehouseId?: string
  warehouseName?: string
}

interface VoicePlan {
  operation: "INVOICE" | "VOUCHER"
  customerId: string
  customerName: string
  items?: VoicePlanItem[]
  totalAmount?: number
  paymentType?: "CASH" | "CREDIT" | "PARTIAL"
  paidAmount?: number
  amount?: number
  voucherType?: "RECEIPT" | "PAYMENT"
}

interface VoiceDraft {
  type?: "INVOICE" | "VOUCHER"
  customerName?: string | null
  customerSuggestions?: string[]
  warehouseName?: string | null
  warehouseSuggestions?: string[]
  productSuggestions?: string[]
  pendingProductName?: string | null
  items?: Array<{
    productName?: string | null
    quantity?: number | null
    unit?: "PIECE" | "DOZEN" | "CARTON" | null
    unitPrice?: number | null
  }>
  paymentType?: "CASH" | "CREDIT" | "PARTIAL" | null
  paidAmount?: number | null
  amount?: number | null
  voucherType?: "RECEIPT" | "PAYMENT" | null
}

interface ParseResponse {
  type: "confirm" | "clarify" | "answer"
  plan?: VoicePlan
  confirmText?: string
  question?: string
  text?: string
  suggestions?: string[]
  draft?: VoiceDraft
  resetConversation?: boolean
}

interface ExecuteResponse {
  message?: string
  invoice?: { id: string; invoiceNumber: string }
  voucher?: { id: string; voucherNumber: string }
}

interface LastInvoice {
  id: string
  invoiceNumber: string
}

interface Props {
  compact?: boolean
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  onstart: (() => void) | null
  onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "هلا بيك. احچي وياي بالعراقي عن شغل البرنامج، مثلاً: سجل كارتون طيارة على عباس نقد. قبل ما أثبت أي عملية راح أعرضها عليك للتأكيد.",
}

function newMessage(role: Role, text: string): ChatMessage {
  return { id: `${Date.now()}-${Math.random()}`, role, text }
}

function normalizedCommand(value: string) {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
}

function errorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "صلاحية المايك مرفوضة. فعّلها من علامة القفل يم رابط الموقع وجرب مرة ثانية."
  }
  if (error === "no-speech") return "ما سمعت كلام واضح. قرب من المايك وجرب مرة ثانية."
  if (error === "audio-capture") return "ما لكيت مايك شغال على هذا الجهاز."
  if (error === "network") return "خدمة تحويل الصوت ما اتصلت. جرّب Chrome أو اكتب طلبك."
  return "ما قدرت أسمعك. تگدر تعيد المحاولة أو تكتب الطلب."
}

function apiError(error: unknown, fallback: string) {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback
  )
}

function planDetails(plan: VoicePlan) {
  if (plan.operation === "VOUCHER") {
    return [
      ["الزبون", plan.customerName],
      ["نوع السند", plan.voucherType === "PAYMENT" ? "دفع" : "قبض"],
      ["المبلغ", `${(plan.amount ?? 0).toLocaleString("en-US")} د.ع`],
    ]
  }

  const payment = plan.paymentType === "CREDIT"
    ? "آجل"
    : plan.paymentType === "PARTIAL"
      ? `جزئي، الواصل ${(plan.paidAmount ?? 0).toLocaleString("en-US")} د.ع`
      : "نقد"
  return [
    ["الزبون", plan.customerName],
    ["المواد", `${plan.items?.length ?? 0}`],
    ["المجموع", `${(plan.totalAmount ?? 0).toLocaleString("en-US")} د.ع`],
    ["الدفع", payment],
  ]
}

export function VoiceInvoiceButton({ compact = false }: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [pendingPlan, setPendingPlan] = useState<VoicePlan | null>(null)
  const [pendingText, setPendingText] = useState("")
  const [draft, setDraft] = useState<VoiceDraft>({})
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [lastInvoice, setLastInvoice] = useState<LastInvoice | null>(null)
  const draftHistoryRef = useRef<VoiceDraft[]>([])
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, pendingPlan, busy])

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  useEffect(() => () => recognitionRef.current?.stop(), [])

  function appendAssistant(text: string) {
    setMessages((current) => [...current, newMessage("assistant", text)])
  }

  async function sendCommand(rawCommand: string) {
    const command = rawCommand.trim()
    if (!command || busy) return
    const normalized = normalizedCommand(command)

    const wantsWhatsApp =
      /واتس\s*اب|واتساب|whatsapp/i.test(normalized) &&
      /ارسل|ارسله|ارسلها|دز|دزها|ابعث|ابعثها/.test(normalized)

    if (wantsWhatsApp) {
      setMessages((current) => [...current, newMessage("user", command)])
      setInput("")
      if (!lastInvoice) {
        appendAssistant("ما عندي فاتورة مثبتة بهذه المحادثة حتى أرسلها. ثبّت الفاتورة أولاً، وبعدها گلي: أرسلها واتساب.")
        return
      }

      setBusy(true)
      try {
        await api.post(`/whatsapp/send-invoice/${lastInvoice.id}`)
        appendAssistant(`تم إرسال الفاتورة ${lastInvoice.invoiceNumber} إلى واتساب الزبون بنجاح.`)
      } catch (error) {
        appendAssistant(apiError(error, "تعذر إرسال الفاتورة إلى واتساب. تأكد من رقم الزبون وإعدادات ربط واتساب."))
      } finally {
        setBusy(false)
      }
      return
    }

    if (pendingPlan && /^(اي|نعم|تمام|ثبت|ثبتها|اثبت|اثبتها|موافق|توكل)$/.test(normalized)) {
      setMessages((current) => [...current, newMessage("user", command)])
      await executePlan(pendingPlan)
      return
    }

    if (pendingPlan && /^(لا|عدل|اريد اعدل|لا اريد اعدل|غيرها)$/.test(normalized)) {
      setMessages((current) => [
        ...current,
        newMessage("user", command),
        newMessage("assistant", "تمام، عدّل اللي تريده بالكلام: السعر، العدد، المادة، الزبون، الدفع أو المخزن."),
      ])
      setPendingPlan(null)
      setPendingText("")
      inputRef.current?.focus()
      return
    }

    if (/^(تراجع|ارجع|رجع اخر تعديل)$/.test(normalized)) {
      const previous = draftHistoryRef.current.pop()
      setMessages((current) => [...current, newMessage("user", command)])
      if (previous) {
        setDraft(previous)
        setPendingPlan(null)
        setPendingText("")
        setSuggestions([])
        appendAssistant("رجعت آخر تعديل. گلي «كمل» حتى أعرض العملية من جديد.")
      } else {
        appendAssistant("ماكو تعديل سابق أرجع له.")
      }
      return
    }

    const userMessage = newMessage("user", command)
    const history = messages
      .filter((message) => message.id !== "welcome")
      .slice(-8)
      .map((message) => ({ role: message.role, content: message.text }))

    setMessages((current) => [...current, userMessage])
    setInput("")
    setPendingPlan(null)
    setPendingText("")
    setSuggestions([])
    setBusy(true)

    try {
      const { data } = await api.post<ParseResponse>("/voice/parse", { command, history, draft })
      const nextDraft = data.resetConversation ? {} : (data.draft ?? draft)
      if (JSON.stringify(nextDraft) !== JSON.stringify(draft)) {
        draftHistoryRef.current.push(draft)
        draftHistoryRef.current = draftHistoryRef.current.slice(-10)
      }
      setDraft(nextDraft)
      if (data.type === "confirm" && data.plan && data.confirmText) {
        appendAssistant(data.confirmText)
        setPendingPlan(data.plan)
        setPendingText(data.confirmText)
      } else if (data.type === "clarify" && data.question) {
        appendAssistant(data.question)
        setSuggestions(data.suggestions ?? [])
      } else if (data.type === "answer" && data.text) {
        appendAssistant(data.text)
      } else {
        appendAssistant("وصلني جواب غير مكتمل. وضح طلبك بكلمات ثانية.")
      }
    } catch (error) {
      appendAssistant(apiError(error, "صار خطأ بالاتصال بالمساعد. جرّب مرة ثانية."))
    } finally {
      setBusy(false)
    }
  }

  async function executePlan(planOverride?: VoicePlan) {
    const plan = planOverride ?? pendingPlan
    if (!plan || busy) return
    setBusy(true)
    try {
      const { data } = await api.post<ExecuteResponse>("/voice/execute", { plan })
      appendAssistant(data.message ?? "تم تنفيذ العملية بنجاح.")
      const invoiceId = data.invoice?.id
      if (data.invoice?.id && data.invoice.invoiceNumber) {
        setLastInvoice({
          id: data.invoice.id,
          invoiceNumber: data.invoice.invoiceNumber,
        })
        appendAssistant("إذا تريد، گلي «أرسلها واتساب» وأرسل الفاتورة للزبون مباشرة.")
      }
      setPendingPlan(null)
      setPendingText("")
      setDraft({})
      setSuggestions([])
      draftHistoryRef.current = []
      if (invoiceId) window.setTimeout(() => navigate(`/invoices/${invoiceId}`), 450)
    } catch (error) {
      appendAssistant(apiError(error, "ما تم تنفيذ العملية. راجع المعلومات وجرب مرة ثانية."))
    } finally {
      setBusy(false)
    }
  }

  async function startListening() {
    const speechApi =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition

    if (!speechApi) {
      appendAssistant("هذا المتصفح ما يدعم الإدخال الصوتي. استخدم Chrome أو اكتب طلبك.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
    } catch {
      appendAssistant(errorMessage("not-allowed"))
      return
    }

    const recognition = new speechApi()
    recognition.lang = "ar-IQ"
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onstart = () => setListening(true)
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? ""
      if (transcript) void sendCommand(transcript)
      else appendAssistant("ما سمعت كلام واضح. جرّب مرة ثانية.")
    }
    recognition.onerror = (event) => appendAssistant(errorMessage(event.error))
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch {
      appendAssistant("تعذر تشغيل المايك. حدّث الصفحة وجرب مرة ثانية.")
      setListening(false)
    }
  }

  function resetConversation() {
    recognitionRef.current?.stop()
    setMessages([welcomeMessage])
    setPendingPlan(null)
    setPendingText("")
    setDraft({})
    setSuggestions([])
    draftHistoryRef.current = []
    setInput("")
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void sendCommand(input)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center justify-center gap-2 border border-teal-200 bg-teal-50 font-semibold text-teal-800 transition hover:border-teal-300 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200",
          compact ? "h-9 rounded-lg px-3 text-sm" : "h-11 rounded-lg px-4",
        )}
        title="فتح المساعد الذكي"
      >
        <Bot className="h-4 w-4" />
        <span>المساعد الذكي</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" dir="rtl">
          <section
            className="flex h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-950 sm:h-[min(760px,90dvh)] sm:max-w-2xl sm:rounded-lg sm:border sm:border-slate-200 sm:dark:border-slate-800"
            role="dialog"
            aria-modal="true"
            aria-label="المساعد الذكي"
          >
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-600 text-white">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-bold text-slate-900 dark:text-white">مساعد المخزون الذكي</h2>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">يفهم اللهجة العراقية وينفذ بعد تأكيدك</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={resetConversation} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="محادثة جديدة">
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="إغلاق">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-4 py-5 dark:bg-slate-900/70 sm:px-6">
              {messages.map((message) => (
                <div key={message.id} className={cn("flex", message.role === "user" ? "justify-start" : "justify-end")}>
                  <div className={cn(
                    "max-w-[88%] whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-7",
                    message.role === "user"
                      ? "bg-teal-600 text-white"
                      : "border border-slate-200 bg-white text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100",
                  )}>
                    {message.text}
                  </div>
                </div>
              ))}

              {pendingPlan ? (
                <div className="mr-auto max-w-[92%] rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
                  <div className="mb-3 text-sm font-bold text-amber-900 dark:text-amber-200">راجع العملية قبل التثبيت</div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                    {planDetails(pendingPlan).map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                        <dd className="font-semibold text-slate-900 dark:text-white">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {pendingPlan.items?.length ? (
                    <div className="mt-3 border-t border-amber-200 pt-3 dark:border-amber-800">
                      {pendingPlan.items.map((item) => (
                        <div key={`${item.productId}-${item.unit}`} className="flex justify-between gap-3 py-1 text-xs text-slate-700 dark:text-slate-300">
                          <span>
                            {item.productName} × {item.quantity}
                            {item.warehouseName ? ` — ${item.warehouseName}` : ""}
                          </span>
                          <span>{item.totalPrice.toLocaleString("en-US")} د.ع</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 flex gap-2">
                    <button type="button" disabled={busy} onClick={() => { setPendingPlan(null); setPendingText(""); inputRef.current?.focus() }} className="h-9 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                      لا، أريد أعدّل
                    </button>
                    <button type="button" disabled={busy} onClick={() => void executePlan()} className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      نعم، ثبّت
                    </button>
                  </div>
                  <span className="sr-only">{pendingText}</span>
                </div>
              ) : null}

              {!pendingPlan && suggestions.length ? (
                <div className="mr-auto flex max-w-[92%] flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={busy}
                      onClick={() => void sendCommand(suggestion)}
                      className="rounded-full border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 disabled:opacity-60 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-200"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}

              {busy && !pendingPlan ? (
                <div className="flex justify-end">
                  <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin" /> جاي أفهم طلبك...
                  </div>
                </div>
              ) : null}
            </div>

            <form onSubmit={submit} className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950 sm:p-4">
              <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white p-1.5 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-100 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:ring-teal-950">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={busy}
                  placeholder="احچي أو اكتب طلبك..."
                  className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:opacity-60 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => listening ? recognitionRef.current?.stop() : void startListening()}
                  disabled={busy}
                  className={cn(
                    "grid h-10 w-10 shrink-0 place-items-center rounded-lg transition disabled:opacity-50",
                    listening ? "bg-rose-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800",
                  )}
                  title={listening ? "إيقاف الاستماع" : "تكلم"}
                >
                  {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </button>
                <button type="submit" disabled={busy || !input.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-600 text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-40" title="إرسال">
                  <Send className="h-4 w-4 rtl:rotate-180" />
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-slate-400">المساعد مختص بالبرنامج والمخزون والحسابات فقط</p>
            </form>
          </section>
        </div>
      ) : null}
    </>
  )
}
