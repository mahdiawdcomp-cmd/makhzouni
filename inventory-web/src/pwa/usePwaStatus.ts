import { useEffect, useRef, useState } from "react"
import { registerSW } from "virtual:pwa-register"

export type SyncFailure = { url: string; method: string; status: number; message?: string }

function requestSync() {
  navigator.serviceWorker.controller?.postMessage({
    type: "PWA_SYNC_NOW",
    token: localStorage.getItem("inventory_token"),
  })
}

export function usePwaStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [syncFailures, setSyncFailures] = useState<{ at: number; items: SyncFailure[] } | null>(null)
  const [authBlockedAt, setAuthBlockedAt] = useState<number | null>(null)
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)

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
    updateSWRef.current = updateSW

    const onOnline = () => {
      setIsOnline(true)
      requestSync()
      navigator.serviceWorker.controller?.postMessage({ type: "PWA_QUEUE_COUNT_REQUEST" })
    }
    const onOffline = () => setIsOnline(false)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PWA_QUEUE_COUNT") {
        setPendingCount(Number(event.data.count ?? 0))
      }
      if (event.data?.type === "PWA_SYNC_DONE") {
        setLastSyncAt(Date.now())
      }
      if (event.data?.type === "PWA_SYNC_FAILED") {
        setSyncFailures({ at: Date.now(), items: (event.data.failed ?? []) as SyncFailure[] })
      }
      if (event.data?.type === "PWA_SYNC_AUTH") {
        setAuthBlockedAt(Date.now())
      }
    }

    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    navigator.serviceWorker.addEventListener("message", onMessage)
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.active?.postMessage({ type: "PWA_QUEUE_COUNT_REQUEST" })
        requestSync()
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
    if (updateSWRef.current) {
      void updateSWRef.current(true)
    } else {
      window.location.reload()
    }
  }

  function syncNow() {
    requestSync()
  }

  return { isOnline, pendingCount, needsRefresh, lastSyncAt, syncFailures, authBlockedAt, refreshApp, syncNow }
}
