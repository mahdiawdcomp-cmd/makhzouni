// «شاشة التجهيز» — live mirror of the invoice being typed at the cashier, shown
// on a second (extended) monitor for the prep workers upstairs. Both windows
// run in the same browser on the same PC, so we talk over BroadcastChannel
// (instant) and keep the last snapshot in localStorage so a freshly opened /
// reloaded prep window shows the current invoice straight away.

export interface PrepLine {
  key: string
  name: string
  imageUrl: string | null
  quantity: number
  unit: "PIECE" | "DOZEN" | "BOX" | "CARTON"
  notes?: string
}

export interface PrepSnapshot {
  /** Identifies one invoice draft (tab id / draft key) so a different draft is a new order. */
  draftId: string
  customerName: string | null
  lines: PrepLine[]
  updatedAt: number
}

const CHANNEL = "prep-screen"
const STORAGE_KEY = "prep_screen_live"

let channel: BroadcastChannel | null = null
function getChannel() {
  if (typeof BroadcastChannel === "undefined") return null
  if (!channel) channel = new BroadcastChannel(CHANNEL)
  return channel
}

export function publishPrep(snapshot: PrepSnapshot) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)) } catch { /* ignore */ }
  try { getChannel()?.postMessage(snapshot) } catch { /* ignore */ }
}

export function readPrep(): PrepSnapshot | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    return s && Array.isArray(s.lines) ? s : null
  } catch {
    return null
  }
}

export function subscribePrep(cb: (s: PrepSnapshot) => void) {
  const ch = getChannel()
  const onMsg = (e: MessageEvent) => { if (e.data && Array.isArray(e.data.lines)) cb(e.data) }
  ch?.addEventListener("message", onMsg)
  // Fallback for browsers without BroadcastChannel.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue) { try { cb(JSON.parse(e.newValue)) } catch { /* ignore */ } }
  }
  if (!ch) window.addEventListener("storage", onStorage)
  return () => {
    ch?.removeEventListener("message", onMsg)
    window.removeEventListener("storage", onStorage)
  }
}
