import { useRef, useState } from "react"
import { Mic, MicOff, Loader2, CheckCircle2, AlertCircle, HelpCircle } from "lucide-react"
import { api } from "../../api/client"
import { cn } from "../../utils/cn"

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function unitLabel(unit: string) {
  if (unit === "CARTON") return "كرتون"
  if (unit === "DOZEN") return "درزن"
  return "قطعة"
}

function payLabel(pay: string) {
  if (pay === "CASH") return "نقداً"
  if (unit === "CREDIT") return "دين"
  return "جزئي"
}

// ── Main Component ────────────────────────────────────────────────────────────

export function VoiceInvoiceButton() {
  const [status, setStatus] = useState<Status>("idle")
  const [statusText, setStatusText] = useState("")
  const [lastInvoice, setLastInvoice] = useState<VoiceInvoiceResponse["invoice"] | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  // ── إرسال النص للـ API ──────────────────────────────────────────────────────
  async function sendCommand(text: string) {
    setStatus("loading")
    setStatusText(`فهمت: "${text}"`)

    try {
      const { data } = await api.post<VoiceInvoiceResponse>("/voice/invoice", {
        command: text,
      })

      if (data.clarify) {
        // النظام يحتاج توضيح — اسأل ثم استمع تلقائياً
        setStatus("clarify")
        setStatusText(data.clarify)
        setTimeout(() => startListening(), 2500)
        return
      }

      if (data.invoice) {
        setLastInvoice(data.invoice)
        setStatus("success")
        setStatusText(
          `✅ فاتورة ${data.invoice.invoiceNumber} — ${data.invoice.customerName}`
        )
        // فتح صفحة الطباعة بعد ثانية
        setTimeout(() => {
          window.open(`/invoices/${data.invoice!.id}`, "_blank")
        }, 1000)
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "حصل خطأ — حاول مرة ثانية"
      setStatus("error")
      setStatusText(msg)
    }
  }

  // ── بدء الاستماع ────────────────────────────────────────────────────────────
  function startListening() {
    const SpeechRecognitionAPI =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition })
        .SpeechRecognition ??
      (
        window as unknown as {
          webkitSpeechRecognition?: typeof SpeechRecognition
        }
      ).webkitSpeechRecognition

    if (!SpeechRecognitionAPI) {
      setStatus("error")
      setStatusText("المتصفح لا يدعم التعرف على الصوت — جرب Chrome")
      return
    }

    const recognition = new SpeechRecognitionAPI()
    recognition.lang = "ar-IQ"
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setStatus("listening")
      setStatusText("🎤 تكلم الآن...")
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const text = event.results[0]?.[0]?.transcript ?? ""
      if (text.trim()) void sendCommand(text.trim())
      else {
        setStatus("error")
        setStatusText("ما سمعت شيء — حاول مرة ثانية")
      }
    }

    recognition.onerror = () => {
      setStatus("error")
      setStatusText("ما قدرت أسمع — تأكد من الميكروفون")
    }

    recognition.onend = () => {
      if (status === "listening") setStatus("idle")
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  // ── ألوان الزر حسب الحالة ───────────────────────────────────────────────────
  const btnColor = {
    idle:      "bg-indigo-600 hover:bg-indigo-700",
    listening: "bg-red-500 animate-pulse",
    loading:   "bg-slate-400 cursor-not-allowed",
    success:   "bg-emerald-500",
    clarify:   "bg-amber-500",
    error:     "bg-rose-500",
  }[status]

  const BtnIcon = {
    idle:      <Mic className="h-8 w-8" />,
    listening: <MicOff className="h-8 w-8" />,
    loading:   <Loader2 className="h-8 w-8 animate-spin" />,
    success:   <CheckCircle2 className="h-8 w-8" />,
    clarify:   <HelpCircle className="h-8 w-8" />,
    error:     <AlertCircle className="h-8 w-8" />,
  }[status]

  return (
    <div className="flex flex-col items-center gap-3 select-none">

      {/* ── زر الميكروفون ── */}
      <button
        type="button"
        onClick={status === "idle" || status === "success" || status === "error"
          ? startListening
          : undefined}
        disabled={status === "loading"}
        className={cn(
          "h-20 w-20 rounded-full text-white shadow-xl transition-all duration-200",
          "flex items-center justify-center",
          btnColor,
          status !== "loading" && "hover:scale-105 active:scale-95",
        )}
        title="اضغط وتكلم"
      >
        {BtnIcon}
      </button>

      {/* ── نص الحالة ── */}
      {statusText && (
        <div className={cn(
          "max-w-xs rounded-xl px-4 py-2.5 text-sm text-center leading-relaxed",
          status === "success"  && "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
          status === "error"    && "bg-rose-50 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
          status === "clarify"  && "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
          status === "listening"&& "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300",
          status === "loading"  && "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
        )}>
          {statusText}
        </div>
      )}

      {/* ── بطاقة آخر فاتورة ── */}
      {lastInvoice && status === "success" && (
        <div className="w-full max-w-xs rounded-xl border border-emerald-200 bg-emerald-50
                        p-3 text-xs dark:border-emerald-800 dark:bg-emerald-900/20">
          <div className="font-bold text-emerald-700 dark:text-emerald-400 mb-1">
            فاتورة #{lastInvoice.invoiceNumber}
          </div>
          <div className="text-slate-600 dark:text-slate-400 space-y-0.5">
            <div>الزبون: {lastInvoice.customerName}</div>
            <div>المنتج: {lastInvoice.productName}</div>
            <div>
              الكمية: {lastInvoice.quantity} {unitLabel(lastInvoice.unit)}
            </div>
            <div>
              المجموع: {lastInvoice.totalAmount.toLocaleString("en-US")} د.ع
            </div>
          </div>
        </div>
      )}

      {/* ── تلميح ── */}
      {status === "idle" && (
        <p className="text-xs text-slate-400 text-center">
          قل مثلاً: "سوّي فاتورة لمحمد، كارتون شاي، نقداً"
        </p>
      )}
    </div>
  )
}
