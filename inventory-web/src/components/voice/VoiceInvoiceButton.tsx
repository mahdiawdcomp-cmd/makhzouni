import { useRef, useState, type FormEvent } from "react"
import { AlertCircle, CheckCircle2, HelpCircle, Loader2, Mic, MicOff, Send } from "lucide-react"
import { api } from "../../api/client"
import { cn } from "../../utils/cn"

type Status = "idle" | "listening" | "loading" | "success" | "clarify" | "error"

interface VoiceInvoiceResponse {
  success?: boolean
  message?: string
  clarify?: string
  invoice?: {
    id: string
    invoiceNumber: string
    customerName: string
    productName: string
    quantity: number
    unit: string
    totalAmount: number
    paymentType: string
  }
  voucher?: {
    id: string
    voucherNumber: string
    customerName: string
    amount: number
    type: string
  }
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
  abort: () => void
  onstart: (() => void) | null
  onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function unitLabel(unit: string) {
  if (unit === "CARTON") return "كارتون"
  if (unit === "DOZEN") return "درزن"
  return "قطعة"
}

function isStartCommand(text: string) {
  const value = text.trim()
  return /(سوي|سوّي|اكتب|كتب|عدل|هدل).*(فاتورة|سند)/.test(value) || /(فاتورة|سند)/.test(value)
}

function voiceErrorMessage(error?: string) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "الميكروفون مرفوض من المتصفح. اضغط علامة القفل بجانب الرابط واسمح بالمايك."
  }
  if (error === "no-speech") return "ما وصلني صوت واضح. اضغط وتكلم قريب من المايك."
  if (error === "audio-capture") return "المتصفح ما لقى مايك شغال. تأكد من إعدادات المايك بالجهاز."
  if (error === "network") return "خدمة التعرف الصوتي ما اتصلت. جرب Chrome أو اكتب الأمر بالخانة."
  return "ما قدرت أسمع. اسمح للمايك أو اكتب الأمر بالخانة."
}

export function VoiceInvoiceButton({ compact = false }: Props) {
  const [status, setStatus] = useState<Status>("idle")
  const [statusText, setStatusText] = useState("")
  const [typedCommand, setTypedCommand] = useState("")
  const [lastInvoice, setLastInvoice] = useState<VoiceInvoiceResponse["invoice"] | null>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  async function sendCommand(text: string) {
    const command = text.trim()
    if (!command) return

    setStatus("loading")
    setStatusText(isStartCommand(command) ? `فهمت: "${command}"` : `جوابك: "${command}"`)

    try {
      const { data } = await api.post<VoiceInvoiceResponse>("/voice/invoice", { command })

      if (data.clarify) {
        setStatus("clarify")
        setStatusText(data.clarify)
        return
      }

      if (data.invoice) {
        setLastInvoice(data.invoice)
        setStatus("success")
        setStatusText(`تم إنشاء فاتورة ${data.invoice.invoiceNumber} - ${data.invoice.customerName}`)
        window.setTimeout(() => window.open(`/invoices/${data.invoice!.id}`, "_blank"), 800)
        return
      }

      if (data.voucher) {
        setStatus("success")
        setStatusText(`تم إنشاء سند ${data.voucher.voucherNumber} - ${data.voucher.customerName}`)
        return
      }

      setStatus("success")
      setStatusText(data.message ?? "تم تنفيذ الأمر")
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "حصل خطأ، حاول مرة ثانية"
      setStatus("error")
      setStatusText(msg)
    }
  }

  async function requestMicrophoneAccess() {
    if (!navigator.mediaDevices?.getUserMedia) return true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      return true
    } catch {
      setStatus("error")
      setStatusText("الميكروفون مرفوض. اضغط علامة القفل قرب الرابط وفعّل السماح للمايك.")
      return false
    }
  }

  async function startListening() {
    const SpeechRecognitionAPI =
      (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition

    if (!SpeechRecognitionAPI) {
      setStatus("error")
      setStatusText("المتصفح لا يدعم الأوامر الصوتية. جرب Chrome أو اكتب الأمر بالخانة.")
      return
    }

    setStatus("loading")
    setStatusText("جاري طلب صلاحية الميكروفون...")
    if (!(await requestMicrophoneAccess())) return

    const recognition = new SpeechRecognitionAPI()
    recognition.lang = "ar-IQ"
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setStatus("listening")
      setStatusText("تكلم الآن...")
    }

    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript ?? ""
      if (text.trim()) void sendCommand(text)
      else {
        setStatus("error")
        setStatusText("ما سمعت شي، حاول مرة ثانية")
      }
    }

    recognition.onerror = (event) => {
      setStatus("error")
      setStatusText(voiceErrorMessage(event.error))
    }

    recognition.onend = () => {
      setStatus((current) => (current === "listening" ? "idle" : current))
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      setStatus("error")
      setStatusText("تعذر تشغيل المايك. حدث الصفحة وجرب مرة ثانية أو اكتب الأمر.")
    }
  }

  function stopListening() {
    recognitionRef.current?.stop()
    setStatus("idle")
    setStatusText("")
  }

  function submitTypedCommand(event: FormEvent) {
    event.preventDefault()
    const command = typedCommand.trim()
    setTypedCommand("")
    void sendCommand(command)
  }

  const btnColor = {
    idle: "bg-indigo-600 hover:bg-indigo-700",
    listening: "bg-red-500 animate-pulse",
    loading: "bg-slate-500 cursor-not-allowed",
    success: "bg-emerald-600",
    clarify: "bg-amber-500",
    error: "bg-rose-600",
  }[status]

  const BtnIcon = {
    idle: <Mic className={compact ? "h-4 w-4" : "h-7 w-7"} />,
    listening: <MicOff className={compact ? "h-4 w-4" : "h-7 w-7"} />,
    loading: <Loader2 className={cn("animate-spin", compact ? "h-4 w-4" : "h-7 w-7")} />,
    success: <CheckCircle2 className={compact ? "h-4 w-4" : "h-7 w-7"} />,
    clarify: <HelpCircle className={compact ? "h-4 w-4" : "h-7 w-7"} />,
    error: <AlertCircle className={compact ? "h-4 w-4" : "h-7 w-7"} />,
  }[status]

  const voiceButton = (
    <button
      type="button"
      onClick={() => {
        if (status === "listening") stopListening()
        else void startListening()
      }}
      disabled={status === "loading"}
      className={cn(
        compact
          ? "inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white shadow-sm transition"
          : "flex h-20 w-20 items-center justify-center rounded-full text-white shadow-xl transition-all duration-200",
        btnColor,
        status !== "loading" && "active:scale-95",
        !compact && status !== "loading" && "hover:scale-105",
      )}
      title="أوامر صوتية"
    >
      {BtnIcon}
      {compact ? "صوت" : null}
    </button>
  )

  const typedForm = (
    <form onSubmit={submitTypedCommand} className="flex min-w-0 flex-1 items-center gap-1">
      <input
        value={typedCommand}
        onChange={(event) => setTypedCommand(event.target.value)}
        placeholder="اكتب أمر أو جواب..."
        className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      <button
        type="submit"
        disabled={!typedCommand.trim() || status === "loading"}
        className="grid h-9 w-9 place-items-center rounded-lg bg-slate-900 text-white disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900"
        title="إرسال"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  )

  if (compact) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {voiceButton}
          {typedForm}
        </div>
        {statusText ? (
          <div
            className={cn(
              "max-w-full rounded-lg px-3 py-2 text-xs leading-relaxed",
              status === "success" && "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
              status === "error" && "bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
              status === "clarify" && "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
              status === "listening" && "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300",
              status === "loading" && "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
            )}
          >
            {statusText}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex select-none flex-col items-center gap-3">
      {voiceButton}
      {typedForm}

      {statusText ? (
        <div className="max-w-xs rounded-xl bg-slate-100 px-4 py-2.5 text-center text-sm leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {statusText}
        </div>
      ) : null}

      {lastInvoice && status === "success" ? (
        <div className="w-full max-w-xs rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="mb-1 font-bold text-emerald-700 dark:text-emerald-400">
            فاتورة #{lastInvoice.invoiceNumber}
          </div>
          <div className="space-y-0.5 text-slate-600 dark:text-slate-400">
            <div>الزبون: {lastInvoice.customerName}</div>
            <div>المادة: {lastInvoice.productName}</div>
            <div>الكمية: {lastInvoice.quantity} {unitLabel(lastInvoice.unit)}</div>
            <div>المجموع: {lastInvoice.totalAmount.toLocaleString("en-US")} د.ع</div>
          </div>
        </div>
      ) : null}

      {status === "idle" ? (
        <p className="text-center text-xs text-slate-400">
          قل: سوي فاتورة، اكتب فاتورة، عدل فاتورة، أو اكتب سند
        </p>
      ) : null}
    </div>
  )
}
