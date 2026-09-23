import { useEffect, useState } from "react"
import { API_BASE_URL } from "../api/client"

/**
 * «السيرفر واقف» — how long the shop's server has been unreachable.
 *
 * Asks the server's own health endpoint on a timer. That endpoint needs no
 * login and touches no data, so it answers even when the shop is signed out
 * or read-only — which is exactly the state someone is in when they open the
 * program during an outage and cannot even reach the login screen.
 *
 * Two things this must never do:
 *
 *  - Call a failed sign-in an outage. Only a request that never got an answer
 *    counts; an HTTP reply of any status means the server is alive.
 *  - Forget how long it has been down. The moment of the FIRST failure is
 *    written to storage, so closing the program and opening it an hour later
 *    still knows the outage started an hour ago instead of restarting the
 *    clock at zero.
 */

const START_KEY = "makhzouni_outage_started_at"
/** How long a total outage must last before the rescue page takes over. */
export const OUTAGE_PAGE_AFTER_MS = 60 * 60 * 1000
const HEALTHY_INTERVAL_MS = 2 * 60 * 1000
const FAILING_INTERVAL_MS = 30 * 1000
const REQUEST_TIMEOUT_MS = 8000

export type BackendOutage = {
  /** The server has not answered since this moment; null while it is healthy. */
  since: number | null
  /** Milliseconds of continuous silence, 0 while healthy. */
  downForMs: number
  /** The rescue page should take the screen. */
  showRescue: boolean
  /** The machine itself reports no network — a different problem, different advice. */
  offline: boolean
  checking: boolean
  /** Ask again now, for the «حاول مرة ثانية» button. */
  recheck: () => void
}

function readStart(): number | null {
  try {
    const raw = localStorage.getItem(START_KEY)
    if (!raw) return null
    const value = Number(raw)
    // A clock that moved backwards, or junk in storage, must not freeze the
    // program on a rescue page forever.
    return Number.isFinite(value) && value > 0 && value <= Date.now() ? value : null
  } catch { return null }
}

function writeStart(value: number | null) {
  try {
    if (value === null) localStorage.removeItem(START_KEY)
    else localStorage.setItem(START_KEY, String(value))
  } catch { /* storage blocked — detection still works for this session */ }
}

/**
 * The health endpoint sits at the server root, outside /api.
 *
 * Asks whatever address the program ACTUALLY talks to: the desktop keeps the
 * shop's server in `makhzouni_server_url` (that is what the «ربط السيرفر» tab
 * writes), and only falls back to the build's own address. Checking a
 * different server than the app uses would report "everything is fine" while
 * every screen in front of the user fails.
 */
function healthUrl() {
  let configured = ""
  try { configured = localStorage.getItem("makhzouni_server_url") ?? "" } catch { /* storage blocked */ }
  const base = (configured || API_BASE_URL).replace(/\/api\/?$/, "")
  return base.startsWith("http") ? `${base}/health` : "/health"
}

export function useBackendOutage(): BackendOutage {
  const [since, setSince] = useState<number | null>(readStart)
  const [now, setNow] = useState(() => Date.now())
  const [checking, setChecking] = useState(false)
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    /**
     * One attempt. Resolves true when SOMETHING answered.
     *
     * The second attempt is the one that matters in the field: a browser
     * refuses to hand back a reply whose CORS headers do not name this
     * origin, and a fetch that was refused looks exactly like a dead server
     * from here. `no-cors` asks the same question in a form the browser will
     * always deliver — it returns an unreadable answer, but "an answer came
     * back" is the entire question. Without it, a shop pointed at a spare
     * server would be shown the rescue page while everything was fine.
     */
    async function reachable() {
      const url = healthUrl()
      for (const init of [{ cache: "no-store" as const }, { mode: "no-cors" as const }]) {
        const controller = new AbortController()
        const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        try {
          await fetch(url, { ...init, signal: controller.signal })
          return true
        } catch {
          /* try the next form */
        } finally {
          window.clearTimeout(timer)
        }
      }
      return false
    }

    async function check() {
      setChecking(true)
      try {
        if (!(await reachable())) throw new Error("unreachable")
        // Any answer at all — even 500 — means the machine is reachable and
        // someone is listening. That is not this outage.
        if (cancelled) return
        setSince(null)
        writeStart(null)
      } catch {
        if (cancelled) return
        setSince((prev) => {
          if (prev !== null) return prev
          const started = Date.now()
          writeStart(started)
          return started
        })
      } finally {
        if (!cancelled) {
          setChecking(false)
          setNow(Date.now())
        }
      }
    }

    void check()
    const interval = window.setInterval(check, since === null ? HEALTHY_INTERVAL_MS : FAILING_INTERVAL_MS)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [since, tick])

  // The page has to appear on its own an hour in, not only when the next
  // check happens to land.
  useEffect(() => {
    if (since === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 30 * 1000)
    return () => window.clearInterval(timer)
  }, [since])

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  const downForMs = since === null ? 0 : Math.max(0, now - since)
  return {
    since,
    downForMs,
    showRescue: since !== null && downForMs >= OUTAGE_PAGE_AFTER_MS,
    offline,
    checking,
    recheck: () => setTick((t) => t + 1),
  }
}
