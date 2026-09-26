import { useEffect, useRef, useState } from "react"
import { Check, Maximize, Package, Volume2 } from "lucide-react"
import { readPrep, subscribePrep, type PrepLine, type PrepSnapshot } from "../utils/prepScreen"

// «شاشة التجهيز» — opened on the second monitor (/prep). Workers don't read
// Arabic, so everything they need is a big picture + a big Western-digit
// quantity + an English unit tag. No login-bound API calls: data comes live
// from the cashier window on the same PC (see utils/prepScreen.ts).

const UNIT_TAG: Record<PrepLine["unit"], { label: string; cls: string }> = {
  PIECE: { label: "PCS", cls: "bg-sky-500" },
  DOZEN: { label: "DOZEN", cls: "bg-violet-500" },
  BOX: { label: "BOX", cls: "bg-orange-500" },
  CARTON: { label: "CARTON", cls: "bg-rose-600" },
}

const MAX_PREVIOUS = 4

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

function Thumb({ line, className }: { line: PrepLine; className: string }) {
  return line.imageUrl ? (
    <img src={line.imageUrl} alt="" className={`${className} object-contain bg-white`} />
  ) : (
    <div className={`${className} flex items-center justify-center bg-slate-800 text-slate-500`}>
      <Package className="h-1/3 w-1/3" />
    </div>
  )
}

export function PrepScreenPage() {
  const [live, setLive] = useState<PrepSnapshot | null>(readPrep)
  const [previous, setPrevious] = useState<PrepSnapshot[]>([])
  const [done, setDone] = useState<Set<string>>(new Set())
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const liveRef = useRef(live)
  const startedRef = useRef(started)
  startedRef.current = started

  useEffect(() => {
    return subscribePrep((next) => {
      const prev = liveRef.current
      const sameDraft = prev?.draftId === next.draftId
      // Current order finished (saved / cleared) or cashier switched drafts →
      // keep the old one visible in the «previous» strip; workers may still be on it.
      if (prev && prev.lines.length > 0 && (!sameDraft || next.lines.length === 0)) {
        setPrevious((p) => [prev, ...p.filter((x) => x.draftId !== prev.draftId || x.updatedAt !== prev.updatedAt)].slice(0, MAX_PREVIOUS))
        setDone(new Set())
      }
      // Something new or a quantity changed → ding + flash that card.
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
    })
  }, [])

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
  const totalQty = lines.length
  const cols = lines.length <= 2 ? 2 : lines.length <= 6 ? 3 : lines.length <= 12 ? 4 : 5

  return (
    <div dir="ltr" className="flex h-screen select-none flex-col overflow-hidden bg-slate-950 text-white" style={{ fontFamily: '"Cairo", system-ui, sans-serif' }}>
      {!started && (
        <button type="button" onClick={start} className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-6 bg-slate-950/95">
          <Volume2 className="h-24 w-24 text-emerald-400" />
          <div className="text-5xl font-black">START</div>
          <div className="text-xl text-white/60">اضغط للتشغيل (صوت + شاشة كاملة)</div>
        </button>
      )}

      <header className="flex items-center justify-between border-b border-white/10 bg-black/40 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className={`h-4 w-4 rounded-full ${lines.length ? "animate-pulse bg-emerald-400" : "bg-white/20"}`} />
          <div className="text-3xl font-black tracking-wide">{lines.length ? "NEW ORDER" : "WAITING…"}</div>
          {live?.customerName && lines.length > 0 && <div className="text-xl text-white/50">{live.customerName}</div>}
        </div>
        <div className="flex items-center gap-4">
          {lines.length > 0 && (
            <div className="rounded-2xl bg-white/10 px-4 py-1 text-2xl font-bold tabular-nums">
              {done.size} / {totalQty} <Check className="inline h-6 w-6 text-emerald-400" />
            </div>
          )}
          <button type="button" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="Fullscreen" className="cursor-pointer rounded-xl p-2 text-white/50 hover:bg-white/10">
            <Maximize className="h-6 w-6" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-white/25">
            <Package className="h-32 w-32" />
            <div className="text-4xl font-bold">WAITING FOR ORDER</div>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {lines.map((l) => {
              const isDone = done.has(l.key)
              const tag = UNIT_TAG[l.unit] ?? UNIT_TAG.PIECE
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => toggleDone(l.key)}
                  className={`relative flex cursor-pointer flex-col overflow-hidden rounded-3xl border-4 bg-slate-900 text-left transition-all ${
                    flashKey === l.key ? "scale-[1.02] border-yellow-300 shadow-[0_0_40px_rgba(253,224,71,0.5)]" : isDone ? "border-emerald-500 opacity-40" : "border-white/10"
                  }`}
                >
                  <Thumb line={l} className="aspect-square w-full" />
                  <div className="absolute right-3 top-3 flex h-24 min-w-24 items-center justify-center rounded-full border-4 border-white bg-red-600 px-3 text-6xl font-black tabular-nums shadow-xl">
                    {l.quantity}
                  </div>
                  <div className={`absolute left-3 top-3 rounded-xl px-3 py-1 text-xl font-black ${tag.cls}`}>{tag.label}</div>
                  {isDone && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Check className="h-40 w-40 text-emerald-400 drop-shadow-2xl" strokeWidth={4} />
                    </div>
                  )}
                  <div dir="rtl" className="truncate px-3 py-2 text-lg font-semibold text-white/70">{l.name}</div>
                  {l.notes && <div dir="rtl" className="truncate bg-amber-400 px-3 py-1 text-base font-bold text-slate-900">⚠ {l.notes}</div>}
                </button>
              )
            })}
          </div>
        )}
      </main>

      {previous.length > 0 && (
        <footer className="flex gap-3 overflow-x-auto border-t border-white/10 bg-black/50 p-3">
          <div className="flex shrink-0 items-center text-lg font-bold text-white/40">PREVIOUS</div>
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
                  <Thumb line={l} className="h-14 w-14 rounded-lg" />
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
