import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Bell, BellRing, Check, CheckCheck, Maximize, Minus, Package, Plus, Volume2, X } from "lucide-react"
import {
  playPrepDing,
  readPrep,
  subscribePrep,
  type PrepLine,
  type PrepLineStatus,
  type PrepSnapshot,
  type PrepState,
} from "../utils/prepScreen"
import { getPrepLive, getPrepVapidKey, markPrepLine, markPrepReady, subscribePrepPush } from "../api/endpoints"

// «شاشة التجهيز» — opened on the second monitor (/prep) or on a worker's phone.
// Workers don't read Arabic, so everything they need is a picture + a big
// Western-digit quantity + an English unit tag, and every action is a big
// coloured button: ✔ READY, ❗ SHORT (then «how many did you find?»), and
// ORDER READY. Their marks go to the server, which the cashier's invoice polls.

const UNIT_TAG: Record<PrepLine["unit"], { label: string; cls: string }> = {
  PIECE: { label: "PCS", cls: "bg-sky-500" },
  DOZEN: { label: "DOZEN", cls: "bg-violet-500" },
  BOX: { label: "BOX", cls: "bg-orange-500" },
  CARTON: { label: "CARTON", cls: "bg-rose-600" },
}

const CARD_LIMIT = 5 // above this, switch to compact rows so nothing shrinks to unreadable
const POLL_MS = 1500

type Mark = { state: "done" | "short"; found?: number } | null

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

// ── «How many did you find?» pad ────────────────────────────────────────────
function ShortPad({ line, current, onPick, onClear, onClose }: {
  line: PrepLine
  current?: PrepLineStatus
  onPick: (found: number) => void
  onClear: () => void
  onClose: () => void
}) {
  const [n, setN] = useState(current?.state === "short" ? current.found ?? 0 : 0)
  const max = Math.max(0, line.quantity - 1)
  const quick = max <= 23 ? Array.from({ length: max + 1 }, (_, i) => i) : null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-3" onClick={onClose}>
      <div className="w-full max-w-xl rounded-3xl bg-slate-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-4">
          <Thumb line={line} className="h-24 w-24 shrink-0 rounded-2xl" />
          <div className="min-w-0 flex-1">
            <div className="text-3xl font-black text-red-400">SHORT</div>
            <div className="text-xl font-bold">NEED <span className="rounded-lg bg-red-600 px-2 tabular-nums">{line.quantity}</span> {UNIT_TAG[line.unit]?.label}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-xl p-2 text-white/60 hover:bg-white/10"><X className="h-8 w-8" /></button>
        </div>
        <div className="mb-3 text-center text-2xl font-black">HOW MANY FOUND?</div>
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
          <div className="flex items-center justify-center gap-4">
            <button type="button" onClick={() => setN((v) => Math.max(0, v - 1))} className="cursor-pointer rounded-2xl bg-slate-700 p-5 hover:bg-slate-600"><Minus className="h-8 w-8" /></button>
            <div className="min-w-32 text-center text-7xl font-black tabular-nums">{n}</div>
            <button type="button" onClick={() => setN((v) => Math.min(max, v + 1))} className="cursor-pointer rounded-2xl bg-slate-700 p-5 hover:bg-slate-600"><Plus className="h-8 w-8" /></button>
            <button type="button" onClick={() => onPick(n)} className="cursor-pointer rounded-2xl bg-red-600 px-6 py-5 text-3xl font-black hover:bg-red-500">OK</button>
          </div>
        )}
        {current && (
          <button type="button" onClick={onClear} className="mt-4 w-full cursor-pointer rounded-2xl border border-white/20 py-3 text-xl font-bold text-white/70 hover:bg-white/10">
            CLEAR MARK
          </button>
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
  const [padKey, setPadKey] = useState<string | null>(null)
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [signedIn] = useState(hasToken)
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
      if (startedRef.current) playPrepDing()
      // A new order starting takes over the screen.
      if (!sameDraft) setSelectedId(null)
    }
    liveRef.current = next
    setLive(next)
  }, [])

  useEffect(() => subscribePrep(apply), [apply])

  const refresh = useCallback(async () => {
    try {
      const s = await getPrepLive()
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
    if (signedIn && pushState === "on") void enablePush().then((err) => { if (err) { setPushState("off"); setPushError(err) } })
  }, [signedIn]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flashKey) return
    const t = setTimeout(() => setFlashKey(null), 2500)
    return () => clearTimeout(t)
  }, [flashKey])

  // Unfinished orders, newest first. The live one uses the freshest snapshot.
  const openOrders = useMemo(() => {
    const list = (server?.orders ?? [])
      .filter((o) => !o.ready && o.snapshot.lines.length > 0)
      .map((o) => (live && o.snapshot.draftId === live.draftId ? { ...o, snapshot: live } : o))
    if (live && live.lines.length > 0 && !list.some((o) => o.snapshot.draftId === live.draftId)
      && !(server?.orders ?? []).some((o) => o.snapshot.draftId === live.draftId && o.ready)) {
      list.unshift({ snapshot: live, statuses: {}, ready: null })
    }
    return list
  }, [server, live])

  const view = (selectedId && openOrders.find((o) => o.snapshot.draftId === selectedId))
    || (live && openOrders.find((o) => o.snapshot.draftId === live.draftId))
    || openOrders[0]
    || null
  const viewId = view?.snapshot.draftId ?? null

  function statusOf(key: string): PrepLineStatus | undefined {
    const p = viewId ? pending[`${viewId}|${key}`] : undefined
    if (p !== undefined) return p ? { ...p, by: "", at: 0 } : undefined
    return view?.statuses[key]
  }

  async function mark(key: string, m: Mark) {
    if (!viewId) return
    setPending((s) => ({ ...s, [`${viewId}|${key}`]: m }))
    setPadKey(null)
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

  async function orderReady() {
    if (!viewId) return
    try {
      await markPrepReady(viewId, true)
      playPrepDing([1046, 1568])
      setSelectedId(null)
      setActionError("")
      void refresh()
    } catch {
      setActionError("Not saved — check internet / sign in")
    }
  }

  function start() {
    setStarted(true)
    playPrepDing()
    document.documentElement.requestFullscreen?.().catch(() => {})
  }

  async function onEnablePush() {
    setPushState("busy")
    const err = await enablePush()
    setPushError(err ?? "")
    setPushState(err ? "off" : "on")
  }

  // Newest line first — that's what the cashier just added.
  const lines = [...(view?.snapshot.lines ?? [])].reverse()
  const compact = lines.length > CARD_LIMIT
  const doneCount = lines.filter((l) => statusOf(l.key)?.state === "done").length
  const shortCount = lines.filter((l) => statusOf(l.key)?.state === "short").length
  const padLine = padKey ? lines.find((l) => l.key === padKey) : undefined

  function ActionButtons({ line, big }: { line: PrepLine; big?: boolean }) {
    const st = statusOf(line.key)
    const sz = big ? "h-16 text-2xl" : "h-14 text-xl"
    if (!signedIn) return null
    return (
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => mark(line.key, st?.state === "done" ? null : { state: "done" })}
          className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-2xl font-black ${sz} ${st?.state === "done" ? "bg-emerald-500 ring-4 ring-emerald-200" : "bg-emerald-700 hover:bg-emerald-600"}`}
        >
          <Check className="h-7 w-7" strokeWidth={4} /> OK
        </button>
        <button
          type="button"
          onClick={() => setPadKey(line.key)}
          className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-2xl font-black ${sz} ${st?.state === "short" ? "bg-red-500 ring-4 ring-red-200" : "bg-red-800 hover:bg-red-700"}`}
        >
          <AlertTriangle className="h-6 w-6" /> SHORT
        </button>
      </div>
    )
  }

  function ShortBanner({ st }: { st: PrepLineStatus }) {
    return (
      <div className="rounded-xl bg-red-600 px-3 py-1 text-center text-lg font-black">
        ❗ SHORT — FOUND <span className="tabular-nums">{st.found ?? 0}</span>
      </div>
    )
  }

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
          {!signedIn && <div className="max-w-md text-base text-amber-300">Sign in on this device to use OK / SHORT buttons.</div>}
          {pushError && <div className="max-w-md rounded-xl bg-red-600/80 px-4 py-2 text-base">{pushError}</div>}
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
              {shortCount > 0 && <span className="text-red-400">{shortCount}❗</span>}
              <span className="text-white/50">/ {lines.length}</span>
            </div>
          )}
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="Fullscreen" className="hidden cursor-pointer rounded-xl p-2 text-white/50 hover:bg-white/10 sm:block">
            <Maximize className="h-6 w-6" />
          </button>
        </div>
      </header>

      {actionError && <div className="bg-red-600 px-4 py-2 text-center text-lg font-bold">{actionError}</div>}

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
              const st = statusOf(l.key)
              const tag = UNIT_TAG[l.unit] ?? UNIT_TAG.PIECE
              return (
                <div
                  key={l.key}
                  className={`flex flex-col gap-2 rounded-2xl border-4 bg-slate-900 p-2 transition-all ${
                    flashKey === l.key ? "border-yellow-300 bg-yellow-300/10"
                      : st?.state === "short" ? "border-red-500 bg-red-950/40"
                      : st?.state === "done" ? "border-emerald-500 opacity-50" : "border-white/10"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <Thumb line={l} className="h-20 w-20 rounded-xl sm:h-24 sm:w-24" />
                      {st?.state === "done" && <Check className="absolute inset-0 m-auto h-16 w-16 text-emerald-400" strokeWidth={4} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`mb-1 inline-block rounded-lg px-2 py-0.5 text-base font-black ${tag.cls}`}>{tag.label}</div>
                      <div dir="rtl" className="truncate text-base text-white/60">{l.name}</div>
                      {l.notes && <div dir="rtl" className="truncate text-sm font-bold text-amber-300">⚠ {l.notes}</div>}
                    </div>
                    <div className="flex h-20 min-w-20 shrink-0 items-center justify-center rounded-2xl bg-red-600 px-3 text-5xl font-black tabular-nums sm:h-24 sm:min-w-24 sm:text-6xl">
                      {l.quantity}
                    </div>
                  </div>
                  {st?.state === "short" && <ShortBanner st={st} />}
                  <ActionButtons line={l} />
                </div>
              )
            })}
          </div>
        ) : (
          // Few items: cards with a capped picture so it never swallows the screen.
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {lines.map((l) => {
              const st = statusOf(l.key)
              const tag = UNIT_TAG[l.unit] ?? UNIT_TAG.PIECE
              return (
                <div
                  key={l.key}
                  className={`relative flex flex-col overflow-hidden rounded-3xl border-4 bg-slate-900 transition-all ${
                    flashKey === l.key ? "border-yellow-300 shadow-[0_0_40px_rgba(253,224,71,0.5)]"
                      : st?.state === "short" ? "border-red-500"
                      : st?.state === "done" ? "border-emerald-500" : "border-white/10"
                  }`}
                >
                  <div className="relative">
                    <Thumb line={l} className={`w-full ${st?.state === "done" ? "opacity-40" : ""}`} style={{ height: "min(30vh, 240px)" }} />
                    {st?.state === "done" && <Check className="absolute inset-0 m-auto h-28 w-28 text-emerald-400 drop-shadow-2xl" strokeWidth={4} />}
                  </div>
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
                  <div className="space-y-2 p-3 pt-0">
                    {st?.state === "short" && <ShortBanner st={st} />}
                    <ActionButtons line={l} big />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {signedIn && lines.length > 0 && (
        <div className="border-t border-white/10 bg-black/60 p-2">
          <button
            type="button"
            onClick={orderReady}
            className={`flex w-full cursor-pointer items-center justify-center gap-3 rounded-2xl py-4 text-3xl font-black ${
              doneCount + shortCount === lines.length ? "animate-pulse bg-emerald-500 hover:bg-emerald-400" : "bg-emerald-800 hover:bg-emerald-700"
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
                onClick={() => setSelectedId(id)}
                className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-2xl border-2 bg-slate-900 p-2 ${id === viewId ? "border-yellow-300" : "border-white/10 hover:border-white/40"}`}
              >
                {isLive && <span className="h-3 w-3 animate-pulse rounded-full bg-emerald-400" />}
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

      {padLine && (
        <ShortPad
          line={padLine}
          current={statusOf(padLine.key)}
          onPick={(found) => mark(padLine.key, { state: "short", found })}
          onClear={() => mark(padLine.key, null)}
          onClose={() => setPadKey(null)}
        />
      )}
    </div>
  )
}
