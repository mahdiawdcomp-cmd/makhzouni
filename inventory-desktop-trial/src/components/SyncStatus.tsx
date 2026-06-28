import { useEffect, useState, useCallback } from "react"
import { Wifi, WifiOff, RefreshCw, CheckCircle2, AlertCircle, Upload } from "lucide-react"
import { loadQueue, flushMutationQueue } from "../lib/offline-store"
import { useAuthStore } from "../store/authStore"
import { api } from "../api/client"

type SyncState = "online" | "offline" | "syncing" | "sync-error" | "sync-done"

export function SyncStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [state, setState] = useState<SyncState>(navigator.onLine ? "online" : "offline")
  const [errorMsg, setErrorMsg] = useState("")
  const token = useAuthStore((s) => s.token)

  // Refresh pending count
  const refreshPending = useCallback(async () => {
    const q = await loadQueue()
    setPending(q.length)
  }, [])

  useEffect(() => {
    refreshPending()

    const onOnline = () => { setOnline(true); setState("online") }
    const onOffline = () => { setOnline(false); setState("offline") }
    const onQueue = (e: Event) => setPending((e as CustomEvent<number>).detail)

    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    window.addEventListener("makhzouni:queue-change", onQueue)

    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("makhzouni:queue-change", onQueue)
    }
  }, [refreshPending])

  // Auto-flush when coming back online
  useEffect(() => {
    if (online && pending > 0 && token) {
      void flush()
    }
  }, [online, token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function flush() {
    if (!token) return
    setState("syncing")
    setErrorMsg("")
    try {
      const baseUrl = (api.defaults.baseURL as string) ?? "https://inventory-backend-production-7e85.up.railway.app/api"
      const result = await flushMutationQueue(baseUrl, token)
      if (result.failed > 0) {
        setState("sync-error")
        setErrorMsg(`${result.failed} عملية فشلت`)
        setTimeout(() => setState(online ? "online" : "offline"), 5000)
      } else {
        setState("sync-done")
        setTimeout(() => setState(online ? "online" : "offline"), 2500)
      }
    } catch {
      setState("sync-error")
      setErrorMsg("خطأ في المزامنة")
      setTimeout(() => setState(online ? "online" : "offline"), 4000)
    }
  }

  // Compact bar — shown in header
  const configs: Record<SyncState, { icon: React.ReactNode; text: string; color: string; bg: string }> = {
    online:     { icon: <Wifi size={13} />,         text: "متصل",         color: "#22c55e", bg: "#052e16" },
    offline:    { icon: <WifiOff size={13} />,       text: "غير متصل",     color: "#f59e0b", bg: "#451a03" },
    syncing:    { icon: <RefreshCw size={13} className="animate-spin" />, text: "مزامنة...", color: "#60a5fa", bg: "#1e3a5f" },
    "sync-done":  { icon: <CheckCircle2 size={13} />, text: "تمت المزامنة", color: "#22c55e", bg: "#052e16" },
    "sync-error": { icon: <AlertCircle size={13} />,  text: errorMsg || "خطأ مزامنة", color: "#f87171", bg: "#450a0a" },
  }

  const cfg = configs[state]

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        background: cfg.bg, color: cfg.color,
        borderRadius: 6, padding: "3px 8px", fontSize: 12,
        border: `1px solid ${cfg.color}33`
      }}>
        {cfg.icon}
        <span>{cfg.text}</span>
      </div>

      {pending > 0 && online && (
        <button
          onClick={() => void flush()}
          title={`${pending} عملية في الانتظار — اضغط للمزامنة`}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "#1e3a5f", color: "#60a5fa",
            border: "1px solid #3b82f633", borderRadius: 6,
            padding: "3px 8px", fontSize: 12, cursor: "pointer",
            fontFamily: "inherit"
          }}
        >
          <Upload size={12} />
          {pending}
        </button>
      )}

      {pending > 0 && !online && (
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "#451a03", color: "#f59e0b",
          border: "1px solid #f59e0b33", borderRadius: 6,
          padding: "3px 8px", fontSize: 12
        }}>
          <Upload size={12} />
          {pending} في الانتظار
        </div>
      )}
    </div>
  )
}
