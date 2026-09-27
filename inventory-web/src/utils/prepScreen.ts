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

export interface PrepLineStatus {
  /** done = as invoiced; short = found fewer; count = a different number (can be more). */
  state: "done" | "short" | "count"
  /** For «short» / «count»: how many the worker actually has (0 = none). */
  found?: number
  by: string
  at: number
}

/** «أرسل للتجهيز» — set when the cashier sends the order to the workers' phones. */
export interface PrepSent {
  at: number
  by: string
  urgent: boolean
  note: string | null
  /** Urdu translation of the note (null until translated / if AI is off). */
  noteUr: string | null
  /** null = every worker. */
  targetUserId: string | null
  targetName: string | null
  ack: { by: string; at: number } | null
  reminders: number
}

export interface PrepOrder {
  snapshot: PrepSnapshot
  statuses: Record<string, PrepLineStatus>
  ready: { by: string; at: number } | null
  sent: PrepSent | null
  cancelled: { by: string; at: number } | null
}

export interface PrepState {
  live: PrepSnapshot | null
  /** Newest first. */
  orders: PrepOrder[]
}

/** Stable per-line key: product + unit (+ occurrence when the same pair repeats),
 *  so a worker's mark survives lines being added/removed around it. */
export function prepLineKeys(items: Array<{ product: { id: string }; unit: string }>) {
  const seen = new Map<string, number>()
  return items.map((it) => {
    const base = `${it.product.id}-${it.unit}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}#${n}`
  })
}

/** One id per order: minted when an empty invoice gets its first line, kept
 *  across reloads (the draft autosave restores the lines), dropped once empty. */
export function prepOrderId(draftKey: string, hasLines: boolean) {
  const k = `prep_order_${draftKey}`
  try {
    if (!hasLines) { localStorage.removeItem(k); return `idle-${draftKey}` }
    let id = localStorage.getItem(k)
    if (!id) { id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem(k, id) }
    return id
  } catch {
    return hasLines ? `mem-${draftKey}` : `idle-${draftKey}`
  }
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

/** Short two-tone chime. Browsers only allow it after a user click on the page. */
export function playPrepDing(tones: [number, number] = [880, 1320]) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = "sine"
    o.frequency.setValueAtTime(tones[0], ctx.currentTime)
    o.frequency.setValueAtTime(tones[1], ctx.currentTime + 0.12)
    g.gain.setValueAtTime(0.25, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.5)
    o.onended = () => void ctx.close()
  } catch { /* ignore */ }
}
/** Loud alarm for a new order on the workers' phones: a harsh rising siren,
 *  much louder and rougher than the soft chime. Needs a prior tap on the page. */
export function playPrepSiren() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const g = ctx.createGain()
    g.gain.value = 0.9
    g.connect(ctx.destination)
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      o.type = "square"
      const t0 = ctx.currentTime + i * 0.35
      o.frequency.setValueAtTime(700, t0)
      o.frequency.linearRampToValueAtTime(1500, t0 + 0.3)
      o.connect(g)
      o.start(t0)
      o.stop(t0 + 0.3)
    }
    setTimeout(() => void ctx.close(), 1400)
  } catch { /* ignore */ }
}