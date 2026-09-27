import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Bell, BellRing, Check, CheckCheck, ChevronLeft, ChevronRight, Hash, Maximize, Minus, Package, Plus, Volume2, X } from "lucide-react"
import {
  playPrepDing,
  markFromCount,
  playPrepSiren,
  readPrep,
  subscribePrep,
  type PrepLine,
  type PrepLineStatus,
  type PrepSnapshot,
  type PrepState,
} from "../utils/prepScreen"
import { ackPrepOrder, recordPageView, getPrepLive, markPrepLine, markPrepReady } from "../api/endpoints"
import { enablePrepPush } from "../utils/prepPush"
import { usePrepThumb } from "../utils/prepThumbs"

// «شاشة التجهيز» — opened on the upstairs monitor (/prep) or on a worker's phone.
// Workers don't read Arabic: everything is a picture, a big Western-digit
// quantity and an English unit tag.
//
// Layout: a grid of picture tiles (3 across on a phone, 5 on the monitor),
// each with its quantity and its status colour. Tapping a tile opens it full
// size with three big actions — ✔ DONE, ❗ PROBLEM (how many found) and
// 🔢 OTHER COUNT (any number, can be more) — and swipes to the next item.
// A newly sent order sounds a loud siren, flashes red and vibrates until the
// worker taps RECEIVED; the screen is kept awake while the page is open.

const UNIT_TAG: Record<PrepLine["unit"], { label: string; cls: string }> = {
  PIECE: { label: "PCS", cls: "bg-sky-500" },
  DOZEN: { label: "DOZEN", cls: "bg-violet-500" },
  BOX: { label: "BOX", cls: "bg-orange-500" },
  CARTON: { label: "CARTON", cls: "bg-rose-600" },
}

const POLL_MS = 1500
const SIREN_EVERY_MS = 2500

type Mark = { state: "done" | "short" | "count"; found?: number } | null

function Thumb({ line, className, style }: { line: PrepLine; className: string; style?: React.CSSProperties }) {
  const src = usePrepThumb(line)
  return src ? (
    <img src={src} alt="" style={style} className={`${className} bg-white object-contain`} draggable={false} />
  ) : (
    <div style={style} className={`${className} flex items-center justify-center bg-slate-800 text-slate-500`}>
      <Package className="h-1/3 w-1/3" />
    </div>
  )
}

function hasToken() {
  try { return !!localStorage.getItem("inventory_token") } catch { return false }
}

function readMyId(): string | null {
  try { return (JSON.parse(localStorage.getItem("inventory_user") ?? "null") as { id?: string } | null)?.id ?? null } catch { return null }
}

/** What a mark means for display: colour + short English label. */
function markLook(st: PrepLineStatus | undefined, qty: number) {
  if (!st) return null
  if (st.state === "done") return { ring: "ring-emerald-400", bg: "bg-emerald-600", label: "✔" }
  const found = st.found ?? 0
  if (found > qty) return { ring: "ring-amber-400", bg: "bg-amber-500", label: `${found}` }
  return { ring: "ring-red-500", bg: "bg-red-600", label: found === 0 ? "NONE" : `${found}` }
}

// ── Number pad: «how many found?» (PROBLEM) or «what number?» (OTHER COUNT) ──
function CountPad({ line, mode, current, onPick, onClose }: {
  line: PrepLine
  mode: "short" | "other"
  current?: PrepLineStatus
  onPick: (n: number) => void
  onClose: () => void
}) {
  const [n, setN] = useState(current?.found ?? (mode === "other" ? line.quantity : 0))
  const max = mode === "short" ? Math.max(0, line.quantity - 1) : 9999
  const quick = mode === "short" && max <= 23 ? Array.from({ length: max + 1 }, (_, i) => i) : null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-3" onClick={onClose}>
      <div className="w-full max-w-xl rounded-3xl bg-slate-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-4">
          <Thumb line={line} className="h-24 w-24 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <div className={`text-3xl font-black ${mode === "short" ? "text-red-400" : "text-amber-300"}`}>{mode === "short" ? "PROBLEM" : "OTHER COUNT"}</div>
            <div className="text-xl font-bold">NEED <span className="rounded-lg bg-red-600 px-2 tabular-nums">{line.quantity}</span> {UNIT_TAG[line.unit]?.label}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-xl p-2 text-white/60 hover:bg-white/10"><X className="h-8 w-8" /></button>
        </div>
        <div className="mb-3 text-center text-2xl font-black">{mode === "short" ? "HOW MANY FOUND?" : "HOW MANY DID YOU PREPARE?"}</div>
        {quick ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onPick(q)}
                className={`cursor-pointer rounded-2xl py-4 text-3xl font-black tabular-nums ${q === 0 ? "col-span-2 bg-red-600 hover:bg-red-500" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                {q === 0 ? "0 NONE" : q}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <button type="button" onClick={() => setN((v) => Math.max(0, v - 1))} className="cursor-pointer rounded-2xl bg-slate-700 p-5 hover:bg-slate-600"><Minus className="h-8 w-8" /></button>
            <input
              inputMode="numeric"
              value={n}
              onChange={(e) => { const v = Number(e.target.value.replace(/\D/g, "")); if (Number.isFinite(v)) setN(Math.min(max, v)) }}
              className="w-32 rounded-2xl bg-slate-800 py-3 text-center text-6xl font-black tabular-nums outline-none"
            />
            <button type="button" onClick={() => setN((v) => Math.min(max, v + 1))} className="cursor-pointer rounded-2xl bg-slate-700 p-5 hover:bg-slate-600"><Plus className="h-8 w-8" /></button>
          </div>
        )}
        {!quick && (
          <button type="button" onClick={() => onPick(n)} className="mt-4 w-full cursor-pointer rounded-2xl bg-amber-500 py-4 text-3xl font-black text-slate-900 hover:bg-amber-400">OK</button>
        )}
      </div>
    </div>
  )
}

export function PrepScreenPage() {
  const [live, setLive] = useState<PrepSnapshot | null>(readPrep)
  const [server, setServer] = useState<PrepState | null>(null)
  // Optimistic marks until the next poll confirms them. Keyed `${orderId}|${lineKey}`.
  const [pending, setPending] = useState<Record<string, Mark>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [pad, setPad] = useState<{ key: string; mode: "short" | "other" } | null>(null)
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [signedIn] = useState(hasToken)
  // The upstairs monitor is driven from the cashier's PC — nobody can tap it —
  // so the action buttons only appear on touch devices (the workers' phones).
  // The monitor still shows every mark the phones make.
  const [canAct] = useState(() => hasToken() && window.matchMedia("(pointer: coarse)").matches)
  const [myId] = useState(readMyId)
  // Cancelled orders this phone already OK'd.
  const [dismissed, setDismissed] = useState<string[]>([])
  const canActRef = useRef(canAct)
  const myIdRef = useRef(myId)
  const sentSeenRef = useRef<Map<string, string> | null>(null)
  const [pushState, setPushState] = useState<"off" | "on" | "busy">(() =>
    typeof Notification !== "undefined" && Notification.permission === "granted" ? "on" : "off")
  const [pushError, setPushError] = useState("")
  const [actionError, setActionError] = useState("")
  const liveRef = useRef(live)
  const startedRef = useRef(started)
  useEffect(() => { startedRef.current = started }, [started])

  const apply = useCallback((next: PrepSnapshot) => {
    const prev = liveRef.current
    // Two sources (same-PC channel + server poll) — ignore anything not newer.
    if (prev && next.updatedAt <= prev.updatedAt) return
    const sameDraft = prev?.draftId === next.draftId
    const prevLines = sameDraft ? prev?.lines ?? [] : []
    const changed = next.lines.find((l) => {
      const old = prevLines.find((o) => o.key === l.key)
      return !old || old.quantity !== l.quantity || old.unit !== l.unit
    })
    if (changed) {
      setFlashKey(changed.key)
      // The monitor chimes on every line; phones get the siren for sent orders instead.
      if (startedRef.current && !canActRef.current) playPrepDing()
      // A new order starting takes over the monitor.
      if (!sameDraft && !canActRef.current) setSelectedId(null)
    }
    liveRef.current = next
    setLive(next)
  }, [])

  useEffect(() => subscribePrep(apply), [apply])

  // «سجل الصفحات» — this page lives outside AppLayout, so log it here.
  useEffect(() => { if (signedIn) recordPageView("/prep", "شاشة التجهيز").catch(() => {}) }, [signedIn])

  const refresh = useCallback(async () => {
    try {
      const s = await getPrepLive()
      // Phone: a newly sent (or re-sent / cancelled) order for me takes over the screen.
      if (canActRef.current) {
        const known = sentSeenRef.current
        const firstLoad = known === null
        const next = new Map<string, string>()
        let focus: string | null = null
        let cancelled = false
        for (const o of s.orders) {
          if (!o.sent || (o.sent.targetUserId && o.sent.targetUserId !== myIdRef.current)) continue
          const sig = `${o.sent.at}|${o.cancelled ? "x" : ""}`
          next.set(o.snapshot.draftId, sig)
          if (firstLoad || known?.get(o.snapshot.draftId) === sig) continue
          if (o.cancelled) cancelled = true
          else focus = o.snapshot.draftId
        }
        sentSeenRef.current = next
        if (cancelled && startedRef.current) playPrepDing([440, 330])
        if (focus) { setSelectedId(focus); setOpenKey(null) }
      }
      setServer(s)
      if (s.live) apply(s.live)
    } catch { /* offline — try again */ }
  }, [apply])

  useEffect(() => {
    if (!signedIn) return
    const first = setTimeout(refresh, 0)
    const id = setInterval(refresh, POLL_MS)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [signedIn, refresh])

  // Keep an already-granted subscription registered with the server (new phone login, rotated keys).
  useEffect(() => {
    // Browser permission alone doesn't mean the server has us — show the real result.
    if (signedIn && pushState === "on") void enablePrepPush().then((err) => { if (err) { setPushState("off"); setPushError(err) } })
  }, [signedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flashKey) return
    const t = setTimeout(() => setFlashKey(null), 2500)
    return () => clearTimeout(t)
  }, [flashKey])

  // Keep the screen on while this page is open (after START), so the siren
  // and the order are there the moment one arrives. Re-acquired on return.
  useEffect(() => {
    if (!started || !("wakeLock" in navigator)) return
    let lock: { release: () => Promise<void> } | null = null
    const acquire = () => {
      (navigator as unknown as { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } })
        .wakeLock.request("screen").then((l) => { lock = l }).catch(() => {})
    }
    acquire()
    const onVis = () => { if (document.visibilityState === "visible") acquire() }
    document.addEventListener("visibilitychange", onVis)
    return () => { document.removeEventListener("visibilitychange", onVis); void lock?.release().catch(() => {}) }
  }, [started])

  // Unfinished orders, newest first. The live one uses the freshest snapshot.
  // Monitor: every invoice the cashier opens. Phone: only what was SENT to
  // this worker (or to all), urgent first; a cancelled one stays until OK'd.
  const openOrders = useMemo(() => {
    let list = (server?.orders ?? [])
      .filter((o) => !o.ready && (o.snapshot.lines.length > 0 || o.sent))
      .map((o) => (live && o.snapshot.draftId === live.draftId ? { ...o, snapshot: live } : o))
    if (canAct) {
      list = list
        .filter((o) => o.sent && (!o.sent.targetUserId || o.sent.targetUserId === myId))
        .filter((o) => !(o.cancelled && dismissed.includes(o.snapshot.draftId)))
        .sort((a, b) => Number(Boolean(b.sent?.urgent && !b.cancelled)) - Number(Boolean(a.sent?.urgent && !a.cancelled)))
      return list
    }
    // Monitor: the invoice open right now + sent orders still being prepared.
    // An unsent invoice that is no longer the live one is gone (saved/deleted).
    list = list.filter((o) => !o.cancelled && (o.sent || o.snapshot.draftId === live?.draftId))
    if (live && live.lines.length > 0 && !list.some((o) => o.snapshot.draftId === live.draftId)
      && !(server?.orders ?? []).some((o) => o.snapshot.draftId === live.draftId && (o.ready || o.cancelled))) {
      list.unshift({ snapshot: live, statuses: {}, ready: null, sent: null, cancelled: null })
    }
    return list
  }, [server, live, canAct, myId, dismissed])

  // Phone: sent orders nobody has acknowledged yet → the alarm keeps going.
  const unacked = canAct ? openOrders.filter((o) => o.sent && !o.sent.ack && !o.cancelled) : []
  const alarmOn = started && unacked.length > 0
  useEffect(() => {
    if (!alarmOn) return
    const ring = () => {
      playPrepSiren()
      try { navigator.vibrate?.([600, 200, 600, 200, 600]) } catch { /* ignore */ }
    }
    ring()
    const id = setInterval(ring, SIREN_EVERY_MS)
    return () => { clearInterval(id); try { navigator.vibrate?.(0) } catch { /* ignore */ } }
  }, [alarmOn])

  const view = (selectedId && openOrders.find((o) => o.snapshot.draftId === selectedId))
    || (!canAct && live && openOrders.find((o) => o.snapshot.draftId === live.draftId))
    || openOrders[0]
    || null
  const viewId = view?.snapshot.draftId ?? null

  function statusOf(key: string): PrepLineStatus | undefined {
    const p = viewId ? pending[`${viewId}|${key}`] : undefined
    if (p !== undefined) return p ? { ...p, by: "", at: 0 } : undefined
    return view?.statuses[key]
  }

  // Newest line first — that's what the cashier just added.
  const lines = [...(view?.snapshot.lines ?? [])].reverse()
  const doneCount = lines.filter((l) => statusOf(l.key)?.state === "done").length
  const problemCount = lines.filter((l) => { const s = statusOf(l.key); return s && s.state !== "done" }).length
  const openIndex = openKey ? lines.findIndex((l) => l.key === openKey) : -1
  const openLine = openIndex >= 0 ? lines[openIndex] : undefined
  const padLine = pad ? lines.find((l) => l.key === pad.key) : undefined

  async function mark(key: string, m: Mark) {
    if (!viewId) return
    setPending((s) => ({ ...s, [`${viewId}|${key}`]: m }))
    setPad(null)
    try {
      await markPrepLine(viewId, key, m)
      setActionError("")
      // Drop the optimistic mark only once a fresh poll carries the real one.
      await refresh()
      setPending((s) => { const n = { ...s }; delete n[`${viewId}|${key}`]; return n })
    } catch {
      setActionError("Not saved — check internet / sign in")
      setPending((s) => { const n = { ...s }; delete n[`${viewId}|${key}`]; return n })
    }
  }

  /** Mark from the big view, then move on to the next item still to do. */
  function markAndNext(key: string, m: Mark) {
    void mark(key, m)
    const idx = lines.findIndex((l) => l.key === key)
    const next = lines.slice(idx + 1).concat(lines.slice(0, idx)).find((l) => !statusOf(l.key))
    setOpenKey(next ? next.key : null)
  }

  /** Worker's number → the right state: fewer = short, same = done, more = count. */
  function pickCount(line: PrepLine, n: number) {
    markAndNext(line.key, markFromCount(line.quantity, n))
  }

  function onPadPick(n: number) {
    if (padLine) pickCount(padLine, n)
  }

  async function orderReady() {
    if (!viewId) return
    try {
      await markPrepReady(viewId, true)
      playPrepDing([1046, 1568])
      setSelectedId(null)
      setOpenKey(null)
      setActionError("")
      void refresh()
    } catch {
      setActionError("Not saved — check internet / sign in")
    }
  }

  async function ack(orderId: string) {
    try { await ackPrepOrder(orderId); setActionError(""); void refresh() }
    catch { setActionError("Not saved — check internet / sign in") }
  }

  function start() {
    setStarted(true)
    playPrepDing()
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  async function onEnablePush() {
    setPushState("busy")
    const err = await enablePrepPush()
    setPushError(err ?? "")
    setPushState(err ? "off" : "on")
  }

  // Swipe between items in the big view.
  const touchX = useRef<number | null>(null)
  function step(dir: 1 | -1) {
    if (openIndex < 0 || lines.length === 0) return
    setOpenKey(lines[(openIndex + dir + lines.length) % lines.length].key)
  }

  return (
    <div dir="ltr" className="flex h-[100dvh] select-none flex-col overflow-hidden bg-slate-950 text-white" style={{ fontFamily: '"Cairo", system-ui, sans-serif' }}>
      {!started && (
        <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-6 bg-slate-950/95 p-6 text-center">
          <button type="button" onClick={start} className="flex cursor-pointer flex-col items-center gap-4 rounded-3xl bg-emerald-600 px-12 py-8 hover:bg-emerald-500">
            <Volume2 className="h-16 w-16" />
            <span className="text-5xl font-black">START</span>
          </button>
          <div className="text-lg text-white/60">اضغط للتشغيل (صوت + شاشة كاملة)</div>
          {canAct && pushState !== "on" && (
            <button type="button" onClick={onEnablePush} disabled={pushState === "busy"} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-amber-400 px-6 py-4 text-2xl font-black text-slate-900 hover:bg-amber-300 disabled:opacity-60">
              <BellRing className="h-7 w-7" /> TURN ON NOTIFICATIONS
            </button>
          )}
          {canAct && pushState === "on" && (
            <div className="flex items-center gap-2 text-lg font-bold text-emerald-400"><Bell className="h-5 w-5" /> Notifications ON</div>
          )}
          {!signedIn && window.matchMedia("(pointer: coarse)").matches && <div className="max-w-md text-base text-amber-300">Sign in on this device to use the buttons.</div>}
          {pushError && <div className="max-w-md rounded-xl bg-red-600/80 px-4 py-2 text-base">{pushError}</div>}
        </div>
      )}

      {/* NEW ORDER alarm — red flashing takeover until RECEIVED */}
      {alarmOn && (
        <div className="absolute inset-0 z-[65] flex animate-pulse flex-col items-center justify-center gap-6 bg-red-600 p-6 text-center">
          <BellRing className="h-28 w-28" />
          <div className="text-5xl font-black">{unacked.some((o) => o.sent?.urgent) ? "🔥 URGENT ORDER" : "NEW ORDER"}</div>
          <div className="text-2xl font-bold">{unacked[0].snapshot.lines.length} ITEMS</div>
          <button
            type="button"
            onClick={() => { const id = unacked[0].snapshot.draftId; setSelectedId(id); void ack(id) }}
            className="w-full max-w-md cursor-pointer rounded-3xl bg-white py-6 text-4xl font-black text-red-600 shadow-2xl"
          >
            👍 RECEIVED
          </button>
        </div>
      )}

      <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/40 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-4 w-4 shrink-0 rounded-full ${lines.length ? "animate-pulse bg-emerald-400" : "bg-white/20"}`} />
          <div className="text-2xl font-black tracking-wide sm:text-3xl">{lines.length ? "ORDER" : "WAITING…"}</div>
          {view?.snapshot.customerName && lines.length > 0 && <div dir="rtl" className="truncate text-lg text-white/50">{view.snapshot.customerName}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {lines.length > 0 && (
            <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-1 text-xl font-bold tabular-nums">
              <span className="text-emerald-400">{doneCount}✔</span>
              {problemCount > 0 && <span className="text-red-400">{problemCount}❗</span>}
              <span className="text-white/50">/ {lines.length}</span>
            </div>
          )}
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="Fullscreen" className="hidden cursor-pointer rounded-xl p-2 text-white/50 hover:bg-white/10 sm:block">
            <Maximize className="h-6 w-6" />
          </button>
        </div>
      </header>

      {actionError && <div className="bg-red-600 px-4 py-2 text-center text-lg font-bold">{actionError}</div>}

      {/* Order banner: cancelled / urgent / sent-to / note */}
      {view?.cancelled ? (
        <div className="flex flex-col items-center gap-3 bg-red-700 px-4 py-6 text-center">
          <div className="text-4xl font-black">❌ CANCELLED — STOP</div>
          <div className="text-lg text-white/80">Do not prepare this order</div>
          {canAct && (
            <button
              type="button"
              onClick={() => { setDismissed((d) => [...d, view.snapshot.draftId]); setSelectedId(null) }}
              className="cursor-pointer rounded-2xl bg-white px-10 py-3 text-2xl font-black text-red-700"
            >
              OK
            </button>
          )}
        </div>
      ) : view?.sent && (
        <div className="space-y-2 border-b border-white/10 bg-black/30 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-base font-bold">
            {view.sent.urgent && <span className="animate-pulse rounded-lg bg-orange-600 px-3 py-1 text-xl font-black">🔥 URGENT</span>}
            <span className="rounded-lg bg-sky-700 px-2 py-1">🔔 {view.sent.targetName ?? "ALL"}</span>
            {view.sent.ack && <span className="rounded-lg bg-emerald-700 px-2 py-1">👍 {view.sent.ack.by}</span>}
          </div>
          {view.sent.note && (
            <div className="rounded-xl bg-amber-400 px-3 py-2 text-slate-900">
              {view.sent.noteUr && <div dir="rtl" lang="ur" className="text-2xl font-black leading-snug" style={{ fontFamily: '"Noto Nastaliq Urdu", "Cairo", system-ui, sans-serif' }}>📝 {view.sent.noteUr}</div>}
              <div dir="rtl" className={view.sent.noteUr ? "text-sm font-semibold opacity-70" : "text-xl font-black"}>{view.sent.noteUr ? view.sent.note : `📝 ${view.sent.note}`}</div>
            </div>
          )}
        </div>
      )}

      {/* Picture grid — 3 across on a phone, 5 on the monitor */}
      <main className="flex-1 overflow-y-auto p-2 sm:p-3">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-white/25">
            <Package className="h-28 w-28" />
            <div className="text-3xl font-bold sm:text-4xl">WAITING FOR ORDER</div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-5 lg:gap-3">
            {lines.map((l) => {
              const st = statusOf(l.key)
              const look = markLook(st, l.quantity)
              const tag = UNIT_TAG[l.unit] ?? UNIT_TAG.PIECE
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setOpenKey(l.key)}
                  className={`relative aspect-square cursor-pointer overflow-hidden rounded-2xl bg-slate-900 ring-4 transition-all ${
                    flashKey === l.key ? "ring-yellow-300" : look ? look.ring : "ring-white/10"
                  }`}
                >
                  <Thumb line={l} className={`h-full w-full ${st?.state === "done" ? "opacity-40" : ""}`} />
                  <span className="absolute right-1 top-1 flex h-11 min-w-11 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1.5 text-2xl font-black tabular-nums shadow-lg lg:h-14 lg:min-w-14 lg:text-3xl">
                    {l.quantity}
                  </span>
                  <span className={`absolute bottom-1 left-1 rounded-md px-1.5 text-xs font-black lg:text-sm ${tag.cls}`}>{tag.label}</span>
                  {l.notes && <span className="absolute left-1 top-1 rounded-md bg-amber-400 px-1 text-sm font-black text-slate-900">⚠</span>}
                  {look && (
                    <span className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-0.5 text-lg font-black ${look.bg}`}>
                      {st?.state === "done" ? <Check className="h-6 w-6" strokeWidth={4} /> : <>❗ {look.label}</>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </main>

      {canAct && lines.length > 0 && !view?.cancelled && (
        <div className="border-t border-white/10 bg-black/60 p-2">
          <button
            type="button"
            onClick={orderReady}
            className={`flex w-full cursor-pointer items-center justify-center gap-3 rounded-2xl py-4 text-3xl font-black ${
              doneCount + problemCount === lines.length ? "animate-pulse bg-emerald-500 hover:bg-emerald-400" : "bg-emerald-800 hover:bg-emerald-700"
            }`}
          >
            <CheckCheck className="h-9 w-9" /> ORDER READY
          </button>
        </div>
      )}

      {openOrders.length > 1 && (
        <footer className="flex gap-3 overflow-x-auto border-t border-white/10 bg-black/50 p-2">
          <div className="flex shrink-0 items-center text-base font-bold text-white/40">ORDERS</div>
          {openOrders.map((o) => {
            const id = o.snapshot.draftId
            const isLive = live?.draftId === id && live.lines.length > 0
            return (
              <button
                key={id}
                type="button"
                onClick={() => { setSelectedId(id); setOpenKey(null) }}
                className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-2xl border-2 bg-slate-900 p-2 ${id === viewId ? "border-yellow-300" : "border-white/10 hover:border-white/40"}`}
              >
                {isLive && <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-400" />}
                {o.cancelled ? <span className="text-xl">❌</span> : o.sent?.urgent ? <span className="text-xl">🔥</span> : null}
                {o.snapshot.lines.slice(0, 4).map((l) => (
                  <div key={l.key} className="relative">
                    <Thumb line={l} className="h-12 w-12 rounded-lg" />
                    <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-sm font-black">{l.quantity}</span>
                  </div>
                ))}
                {o.snapshot.lines.length > 4 && <span className="text-lg font-bold text-white/50">+{o.snapshot.lines.length - 4}</span>}
              </button>
            )
          })}
        </footer>
      )}

      {/* Big view of one item: picture, quantity, actions; swipe for the next */}
      {openLine && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-slate-950"
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
          onTouchEnd={(e) => {
            if (touchX.current === null) return
            const dx = e.changedTouches[0].clientX - touchX.current
            touchX.current = null
            if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1)
          }}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-xl font-bold tabular-nums text-white/60">{openIndex + 1} / {lines.length}</div>
            <button type="button" onClick={() => setOpenKey(null)} aria-label="Close" className="cursor-pointer rounded-xl p-2 text-white/70 hover:bg-white/10"><X className="h-9 w-9" /></button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-2">
            <button type="button" onClick={() => step(-1)} aria-label="Previous" className="absolute left-1 z-10 cursor-pointer rounded-full bg-black/50 p-2"><ChevronLeft className="h-8 w-8" /></button>
            <Thumb line={openLine} className="h-full max-h-full w-full rounded-2xl" />
            <button type="button" onClick={() => step(1)} aria-label="Next" className="absolute right-1 z-10 cursor-pointer rounded-full bg-black/50 p-2"><ChevronRight className="h-8 w-8" /></button>
          </div>
          <div className="space-y-3 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className={`rounded-lg px-3 py-1 text-2xl font-black ${(UNIT_TAG[openLine.unit] ?? UNIT_TAG.PIECE).cls}`}>{(UNIT_TAG[openLine.unit] ?? UNIT_TAG.PIECE).label}</span>
                <div dir="rtl" className="mt-1 truncate text-base text-white/60">{openLine.name}</div>
              </div>
              <div className="flex h-24 min-w-24 items-center justify-center rounded-3xl bg-red-600 px-4 text-7xl font-black tabular-nums">{openLine.quantity}</div>
            </div>
            {openLine.notes && <div dir="rtl" className="rounded-xl bg-amber-400 px-3 py-1 text-lg font-bold text-slate-900">⚠ {openLine.notes}</div>}
            {(() => {
              const st = statusOf(openLine.key)
              const look = markLook(st, openLine.quantity)
              return look && st?.state !== "done"
                ? <div className={`rounded-xl px-3 py-2 text-center text-2xl font-black ${look.bg}`}>{(st?.found ?? 0) > openLine.quantity ? "🔢 PREPARED" : "❗ FOUND"} {st?.found ?? 0}</div>
                : null
            })()}
            {canAct && !view?.cancelled && (
              <div className="grid grid-cols-3 gap-2">
                <button type="button" onClick={() => markAndNext(openLine.key, { state: "done" })} className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl bg-emerald-600 py-4 text-xl font-black hover:bg-emerald-500">
                  <Check className="h-9 w-9" strokeWidth={4} /> DONE
                </button>
                <button type="button" onClick={() => setPad({ key: openLine.key, mode: "short" })} className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl bg-red-600 py-4 text-xl font-black hover:bg-red-500">
                  <AlertTriangle className="h-9 w-9" /> PROBLEM
                </button>
                <button type="button" onClick={() => setPad({ key: openLine.key, mode: "other" })} className="flex cursor-pointer flex-col items-center gap-1 rounded-2xl bg-amber-500 py-4 text-xl font-black text-slate-900 hover:bg-amber-400">
                  <Hash className="h-9 w-9" /> OTHER
                </button>
              </div>
            )}
            {canAct && statusOf(openLine.key) && (
              <button type="button" onClick={() => void mark(openLine.key, null)} className="w-full cursor-pointer rounded-xl border border-white/20 py-2 text-lg font-bold text-white/60">
                CLEAR MARK
              </button>
            )}
          </div>
        </div>
      )}

      {pad && padLine && (
        <CountPad
          line={padLine}
          mode={pad.mode}
          current={statusOf(padLine.key)}
          onPick={onPadPick}
          onClose={() => setPad(null)}
        />
      )}
    </div>
  )
}
