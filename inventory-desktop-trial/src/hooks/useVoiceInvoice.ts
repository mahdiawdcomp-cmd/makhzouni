import { useState, useCallback, useRef } from "react"
import { voiceParse, voiceExecute, type VoiceChatMessage, type VoiceParsedPlan } from "../api/endpoints"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpeechRecognition = any

export type VoiceState = "idle" | "listening" | "processing" | "confirming" | "done" | "error"

export interface UseVoiceInvoiceReturn {
  state: VoiceState
  transcript: string
  reply: string
  plan: VoiceParsedPlan["plan"] | null
  history: VoiceChatMessage[]
  error: string | null
  startListening: () => void
  sendText: (text: string) => Promise<void>
  confirmPlan: () => Promise<{ invoiceId?: string; invoiceNumber?: string } | null>
  reset: () => void
  isSupported: boolean
}

export function useVoiceInvoice(onDone?: (invoiceId: string) => void): UseVoiceInvoiceReturn {
  const [state, setState] = useState<VoiceState>("idle")
  const [transcript, setTranscript] = useState("")
  const [reply, setReply] = useState("")
  const [plan, setPlan] = useState<VoiceParsedPlan["plan"] | null>(null)
  const [history, setHistory] = useState<VoiceChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<AnySpeechRecognition | null>(null)

  const isSupported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

  const reset = useCallback(() => {
    recognitionRef.current?.abort()
    setState("idle")
    setTranscript("")
    setReply("")
    setPlan(null)
    setHistory([])
    setError(null)
  }, [])

  const sendText = useCallback(async (text: string) => {
    if (!text.trim()) return
    setState("processing")
    setError(null)

    const newHistory: VoiceChatMessage[] = [...history, { role: "user", content: text }]

    try {
      const result = await voiceParse({ command: text, history })

      const assistantMsg: VoiceChatMessage = { role: "assistant", content: result.reply }
      setHistory([...newHistory, assistantMsg])
      setReply(result.reply)

      if (result.type === "confirm" && result.plan) {
        setPlan(result.plan)
        setState("confirming")
      } else if (result.type === "cancel") {
        setState("idle")
      } else {
        // clarify or answer — wait for next user input
        setState("idle")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذرت معالجة الأمر")
      setState("error")
    }
  }, [history])

  const startListening = useCallback(() => {
    if (!isSupported) {
      setError("المتصفح لا يدعم الإدخال الصوتي")
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRec = ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) as AnySpeechRecognition
    const recognition: AnySpeechRecognition = new SpeechRec()
    recognition.lang = "ar-IQ"
    recognition.continuous = false
    recognition.interimResults = false
    recognitionRef.current = recognition

    recognition.onstart = () => setState("listening")

    recognition.onresult = (event: AnySpeechRecognition) => {
      const text = event.results[0]?.[0]?.transcript ?? ""
      setTranscript(text)
      if (text.trim()) void sendText(text)
    }

    recognition.onerror = (event: AnySpeechRecognition) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        setState("idle")
        return
      }
      setError(`خطأ في التعرف على الصوت: ${event.error}`)
      setState("error")
    }

    recognition.onend = () => {
      if (state === "listening") setState("idle")
    }

    recognition.start()
  }, [isSupported, sendText, state])

  const confirmPlan = useCallback(async () => {
    if (!plan) return null
    setState("processing")
    try {
      const result = await voiceExecute(plan)
      setState("done")
      if (result.invoiceId) onDone?.(result.invoiceId)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تنفيذ الفاتورة")
      setState("error")
      return null
    }
  }, [plan, onDone])

  return { state, transcript, reply, plan, history, error, startListening, sendText, confirmPlan, reset, isSupported }
}
