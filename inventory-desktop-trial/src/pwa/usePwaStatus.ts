import { useEffect, useState } from "react"

export type SyncFailure = { url: string; method: string; status: number; message?: string }

// The desktop build talks directly to its dedicated trial API. It does not
// register the browser PWA service worker because Tauri already owns the app shell.
export function usePwaStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    return () => {
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [])

  return {
    isOnline,
    pendingCount: 0,
    needsRefresh: false,
    lastSyncAt: null as number | null,
    syncFailures: null as { at: number; items: SyncFailure[] } | null,
    authBlockedAt: null as number | null,
    refreshApp: () => window.location.reload(),
    syncNow: () => undefined,
  }
}
