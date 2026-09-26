import { useCallback, useEffect, useRef, useState } from "react"
import { Bell, BellRing, Check, Maximize, Package, Volume2 } from "lucide-react"
import { readPrep, subscribePrep, type PrepLine, type PrepSnapshot } from "../utils/prepScreen"
import { getPrepLive, getPrepVapidKey, subscribePrepPush } from "../api/endpoints"

// «شاشة التجهيز» — opened on the second monitor (/prep) or on a worker's phone.
// Workers don't read Arabic, so everything they need is a picture + a big
// Western-digit quantity + an English unit tag.
// Sources: the cashier window on the same PC (BroadcastChannel, instant) and,
// when signed in, the server (for phones). Newest snapshot wins.

const UNIT_TAG: Record<PrepLine["unit"], { label: string; cls: string }> = {
  PIECE: { label: "PCS", cls: "bg-sky-500" },
  DOZEN: { label: "DOZEN", cls: "bg-violet-500" },
  BOX: { label: "BOX", cls: "bg-orange-500" },
  CARTON: { label: "CARTON", cls: "bg-rose-600" },
}

const MAX_PREVIOUS = 4
const CARD_LIMIT = 5 // above this, switch to compact rows so nothing shrinks to unreadable
const POLL_MS = 1500

function playDing() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = "sine"
    o.frequency.setValueAtTime(880, ctx.currentTime)
    o.frequency.setValueAtTime(1320, ctx.currentTime + 0.12)
    g.gain.setValueAtTime(0.25, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.5)
    o.onended = () => void ctx.close()
  } catch { /* ignore */ }
}

function Thumb({ line, className, style }: { line: PrepLine; className: string; style?: React.CSSProperties }) {
  return line.imageUrl ? (
    <img src={line.imageUrl} alt="" style={style} className={`${className} bg-white object-contain`} />
  ) : (
    <div style={style} className={`${className} flex items-center justify-center bg-slate-800 text-slate-500`}>
      <Package className="h-1/3 w-1/3" />
    </div>
  )
}

function hasToken() {
  try { return !!localStorage.getItem("inventory_token") } catch { return false }
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

async function enablePush(): Promise<string | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "This browser does not support notifications. Use Chrome."
  }
  const perm = await Notification.requestPermission()
  if (perm !== "granted") return "Notifications are blocked. Allow them in Chrome settings for this site."
  try {
    const key = await getPrepVapidKey()
    if (!key) return "Notifications are not configured on the server."
    const reg = await navigator.serviceWorker.ready
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }))
    await subscribePrepPush(sub.toJSON())
    return null
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    return status === 403 ? "This account has no «إشعارات التجهيز» permission." : "Could not enable notifications."
  }
}

export function PrepScreenPage() {
  const [live, setLive] = useState<PrepSnapshot | null>(readPrep)
  const [previous, setPrevious] = useState<PrepSnapshot[]>([])
  const [done, setDone] = useState<Set<string>>(new Set())
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [signedIn] = useState(hasToken)
  const [pushState, setPushState] = useState<"off" | "on" | "busy">(() =>
    typeof Notification !== "undefined" && Notification.permission === "granted" ? "on" : "off")
  const [pushError, setPushError] = useState("")
  const liveRef = useRef(live)
  const startedRef = useRef(started)
  useEffect(() => { startedRef.current = started }, [started])

  const apply = useCallback((next: PrepSnapshot) => {
    const prev = liveRef.current
    // Two sources (same-PC channel + server poll) — ignore anything not newer.
    if (prev && next.updatedAt <= prev.updatedAt) return
    const sameDraft = prev?.draftId === next.draftId
    // Current order finished (saved / cleared) or cashier switched drafts →
    // keep the old one in the «previous» strip; workers may still be on it.
    if (prev && prev.lines.length > 0 && (!sameDraft || next.lines.length === 0)) {
      setPrevious((p) => [prev, ...p.filter((x) => x !== prev)].slice(0, MAX_PREVIOUS))
      setDone(new Set())
    }
    const prevLines = sameDraft ? prev?.lines ?? [] : []
    const changed = next.lines.find((l) => {
      const old = prevLines.find((o) => o.key === l.key)
      return !old || old.quantity !== l.quantity || old.unit !== l.unit
    })
    if (changed) {
      setFlashKey(changed.key)
      if (startedRef.current) playDing()
    }
    liveRef.current = next
    setLive(next)
  }, [])

  useEffect(() => subscribePrep(apply), [apply])

  // Phones: pull from the server while the page is open.
  useEffect(() => {
    if (!signedIn) return
    let stop = false
    const tick = async () => {
      try { const s = await getPrepLive(); if (!stop && s) apply(s) } catch { /* offline — try again */ }
    }
    void tick()
    const id = setInterval(tick, POLL_MS)
    return () => { stop = true; clearInterval(id) }
  }, [signedIn, apply])

  // Keep an already-granted subscription registered with the server (new phone login, rotated keys).
  useEffect(() => {
    // Browser permission alone doesn't mean the server has us — show the real result.
    if (signedIn && pushState === "on") void enablePush().then((err) => { if (err) { setPushState("off"); setPushError(err) } })
  }, [signedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flashKey) return
    const t = setTimeout(() => setFlashKey(null), 2500)
    return () => clearTimeout(t)
  }, [flashKey])

  function start() {
    setStarted(true)
    playDing()
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  async function onEnablePush() {
    setPushState("busy")
    const err = await enablePush()
    setPushError(err ?? "")
    setPushState(err ? "off" : "on")
  }

  function toggleDone(key: string) {
    setDone((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }

  // Newest line first — that's what the cashier just added.
  const lines = [...(live?.lines ?? [])].reverse()
  const compact = lines.length > CARD_LIMIT

  return (
    <div dir="ltr" className="flex h-[100dvh] select-none flex-col overflow-hidden bg-slate-950 text-white" style={{ fontFamily: '"Cairo", system-ui, sans-serif' }}>
      {!started && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-slate-950/95 p-6 text-center">
          <button type="button" onClick={start} className="flex cursor-pointer flex-col items-center gap-4 rounded-3xl bg-emerald-600 px-12 py-8 hover:bg-emerald-500">
            <Volume2 className="h-16 w-16" />
            <span className="text-5xl font-black">START</span>
          </button>
          <div className="text-lg text-white/60">اضغط للتشغيل (صوت + شاشة كاملة)</div>
          {signedIn && pushState !== "on" && (
            <button type="button" onClick={onEnablePush} disabled={pushState === "busy"} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-amber-400 px-6 py-4 text-2xl font-black text-slate-900 hover:bg-amber-300 disabled:opacity-60">
              <BellRing className="h-7 w-7" /> TURN ON NOTIFICATIONS
            </button>
          )}
          {signedIn && pushState === "on" && (
            <div className="flex items-center gap-2 text-lg font-bold text-emerald-400"><Bell className="h-5 w-5" /> Notifications ON</div>
          )}
          {pushError && <div className="max-w-md rounded-xl bg-red-600/80 px-4 py-2 text-base">{pushError}</div>}
        </div>
      )}

      <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-4 w-4 shrink-0 rounded-full ${lines.length ? "animate-pulse bg-emerald-400" : "bg-white/20"}`} />
          <div className="text-2xl font-black tracking-wide sm:text-3xl">{lines.length ? "NEW ORDER" : "WAITING…"}</div>
          {live?.customerName && lines.length > 0 && <div dir="rtl" className="truncate text-lg text-white/50">{live.customerName}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {lines.length > 0 && (
            <div className="rounded-2xl bg-white/10 px-3 py-1 text-xl font-bold tabular-nums sm:text-2xl">
              {done.size} / {lines.length} <Check className="inline h-6 w-6 text-emerald-400" />
            </div>
          )}
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="Fullscreen" className="cursor-pointer rounded-xl p-2 text-white/50 hover:bg-white/10">
            <Maximize className="h-6 w-6" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-3 sm:p-4">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-white/25">
            <Package className="h-28 w-28" />
            <div className="text-3xl font-bold sm:text-4xl">WAITING FOR ORDER</div>
          </div>
        ) : compact ? (
          // Many items: one row each — small picture, huge quantity. Readable at any count.
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {lines.map((l) => {
              const isDone = done.has(l.key)
              const tag = UNIT_TAG[l.unit] ?? UNIT_TAG.PIECE
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => toggleDone(l.key)}
                  className={`flex cursor-pointer items-center gap-3 rounded-2xl border-4 bg-slate-900 p-2 text-left transition-all ${
                    flashKey === l.key ? "border-yellow-300 bg-yellow-300/10" : isDone ? "border-emerald-500 opacity-40" : "border-white/10"
                  }`}
                >
                  <div className="relative shrink-0">
                    <Thumb line={l} className="h-20 w-20 rounded-xl sm:h-24 sm:w-24" />
                    {isDone && <Check className="absolute inset-0 m-auto h-16 w-16 text-emerald-400" strokeWidth={4} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`mb-1 inline-block rounded-lg px-2 py-0.5 text-base font-black ${tag.cls}`}>{tag.label}</div>
                    <div dir="rtl" className="truncate text-base text-white/60">{l.name}</div>
                    {l.notes && <div dir="rtl" className="truncate text-sm font-bold text-amber-300">⚠ {l.notes}</div>}
                  </div>
                  <div className="flex h-20 min-w-20 shrink-0 items-center justify-center rounded-2xl bg-red-600 px-3 text-5xl font-black tabular-nums sm:h-24 sm:min-w-24 sm:text-6xl">
                    {l.quantity}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          // Few items: cards with a capped picture so it never swallows the screen.
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {lines.map((l) => {
              const isDone = done.has(l.key)
              const tag = UNIT_TAG[l.unit] ?? UNIT_TAG.PIECE
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => toggleDone(l.key)}
                  className={`relative flex cursor-pointer flex-col overflow-hidden rounded-3xl border-4 bg-slate-900 text-left transition-all ${
                    flashKey === l.key ? "border-yellow-300 shadow-[0_0_40px_rgba(253,224,71,0.5)]" : isDone ? "border-emerald-500 opacity-40" : "border-white/10"
                  }`}
                >
                  <Thumb line={l} className="w-full" style={{ height: "min(32vh, 260px)" }} />
                  <div className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className={`mb-1 inline-block rounded-lg px-3 py-0.5 text-xl font-black ${tag.cls}`}>{tag.label}</div>
                      <div dir="rtl" className="truncate text-base text-white/60">{l.name}</div>
                    </div>
                    <div className="flex h-24 min-w-24 shrink-0 items-center justify-center rounded-2xl bg-red-600 px-3 text-6xl font-black tabular-nums">
                      {l.quantity}
                    </div>
                  </div>
                  {l.notes && <div dir="rtl" className="truncate bg-amber-400 px-3 py-1 text-base font-bold text-slate-900">⚠ {l.notes}</div>}
                  {isDone && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Check className="h-32 w-32 text-emerald-400 drop-shadow-2xl" strokeWidth={4} />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </main>

      {previous.length > 0 && (
        <footer className="flex gap-3 overflow-x-auto border-t border-white/10 bg-black/50 p-2">
          <div className="flex shrink-0 items-center text-base font-bold text-white/40">PREVIOUS</div>
          {previous.map((p) => (
            <button
              key={`${p.draftId}-${p.updatedAt}`}
              type="button"
              title="Tap to remove"
              onClick={() => setPrevious((list) => list.filter((x) => x !== p))}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-2xl border border-white/10 bg-slate-900 p-2 hover:border-red-400"
            >
              {p.lines.slice(0, 6).map((l) => (
                <div key={l.key} className="relative">
                  <Thumb line={l} className="h-12 w-12 rounded-lg" />
                  <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-sm font-black">{l.quantity}</span>
                </div>
              ))}
              {p.lines.length > 6 && <span className="text-lg font-bold text-white/50">+{p.lines.length - 6}</span>}
            </button>
          ))}
        </footer>
      )}
    </div>
  )
}
