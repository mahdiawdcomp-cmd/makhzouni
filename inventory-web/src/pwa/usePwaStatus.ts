import { useEffect, useState } from "react"
import { registerSW } from "virtual:pwa-register"

export function usePwaStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [needsRefresh, setNeedsRefresh] = useState(false)

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedsRefresh(true)
      },
      onOfflineReady() {
        console.info("PWA offline cache is ready")
      },
    })

    const onOnline = () => {
      setIsOnline(true)
      navigator.serviceWorker.controller?.postMessage({ type: "PWA_SYNC_NOW" })
      navigator.serviceWorker.controller?.postMessage({ type: "PWA_QUEUE_COUNT_REQUEST" })
    }
    const onOffline = () => setIsOnline(false)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PWA_QUEUE_COUNT") {
        setPendingCount(Number(event.data.count ?? 0))
      }
    }

    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    navigator.serviceWorker.addEventListener("message", onMessage)
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage({ type: "PWA_QUEUE_COUNT_REQUEST" })
      })
      .catch(() => undefined)

    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      navigator.serviceWorker.removeEventListener("message", onMessage)
      void updateSW(false)
    }
  }, [])

  function refreshApp() {
    window.location.reload()
  }

  function syncNow() {
    navigator.serviceWorker.controller?.postMessage({ type: "PWA_SYNC_NOW" })
  }

  return { isOnline, pendingCount, needsRefresh, refreshApp, syncNow }
}
