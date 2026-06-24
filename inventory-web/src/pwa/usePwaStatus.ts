import { useEffect, useRef, useState } from "react"
import { registerSW } from "virtual:pwa-register"

export type SyncFailure = { url: string; method: string; status: number; message?: string }

function requestSync() {
  navigator.serviceWorker.controller?.postMessage({
    type: "PWA_SYNC_NOW",
    token: localStorage.getItem("inventory_token"),
  })
}

// How long the network must be gone before we show the "offline" bar.
// This prevents flashing the banner on brief WiFi handovers / Railway hiccups.
const OFFLINE_GRACE_MS = 4_000

export function usePwaStatus() {
  const [isOnline, setIsOnline] = useState(true)          // optimistic default
  const [pendingCount, setPendingCount] = useState(0)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [syncFailures, setSyncFailures] = useState<{ at: number; items: SyncFailure[] } | null>(null)
  const [authBlockedAt, setAuthBlockedAt] = useState<number | null>(null)
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        // New SW took over — reload silently if no invoice is open,
        // otherwise set the flag so the update banner appears.
        const onInvoice = window.location.pathname === "/invoices/new" ||
                          window.location.pathname === "/pos"
        if (!onInvoice) {
          window.location.reload()
        } else {
          setNeedsRefresh(true)
        }
      },
      onOfflineReady() {
        // Cache is ready — no need to show anything
      },
    })
    updateSWRef.current = updateSW

    const clearOfflineTimer = () => {
      if (offlineTimer.current) { clearTimeout(offlineTimer.current); offlineTimer.current = null }
    }

    const onOnline = () => {
      clearOfflineTimer()
      setIsOnline(true)
      requestSync()
      navigator.serviceWorker.controller?.postMessage({ type: "PWA_QUEUE_COUNT_REQUEST" })
    }

    const onOffline = () => {
      // Wait OFFLINE_GRACE_MS before declaring offline — avoids flicker on
      // brief network transitions (WiFi roaming, Railway keep-alive drops, etc.)
      clearOfflineTimer()
      offlineTimer.current = setTimeout(() => {
        // Double-check with a real request before showing the banner
        fetch("/favicon.svg", { cache: "no-store", mode: "no-cors" })
          .then(() => { /* still online, don't show banner */ })
          .catch(() => setIsOnline(false))
      }, OFFLINE_GRACE_MS)
    }

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
      clearOfflineTimer()
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
