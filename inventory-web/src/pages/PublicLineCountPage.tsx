// «جرد بالسطور» — worker link. Written like an invoice without prices: pick a
// product, type the quantity, next line. The whole catalogue is downloaded on
// first open and every line lives in localStorage, so the worker can count for
// hours with no signal, close the tab, reopen it, and upload at the end. The
// upload itself retries on its own until the server confirms it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { registerSW } from "virtual:pwa-register"
import { CheckCircle2, ChevronDown, CloudOff, CloudUpload, ImageOff, Loader2, Search, Trash2, Wifi, X } from "lucide-react"
import { api } from "../api/client"
import { cn } from "../utils/cn"
import { apiErrorMessage, errorCodeOf } from "../utils/apiError"
import { scoreProduct } from "../utils/search"
import { findProductByScan } from "../utils/barcode-scan"

interface CatalogProduct {
  id: string
  name: string
  itemNumber: string | null
  qrCode: string | null
  cartonQrCode: string | null
  category: string | null
  pcsPerCarton: number
  hasImage?: boolean
}

interface SessionData {
  id: string
  status: string
  notes: string | null
  warehouseName: string
  createdAt: string
  /** Non-empty = the manager sent back only these products for a recount. */
  recountProductIds?: string[]
  recountRound?: number
  products: CatalogProduct[]
  /** A whole count sent back by the manager comes with its saved lines. */
  lines?: { productId: string; qty: number; unit: "PIECE" | "CARTON"; writtenAt: string }[]
  /** What a phone already saved on the server for this round. */
  draft?: { lines: { productId: string; qty: number; unit: "PIECE" | "CARTON"; writtenAt: string }[]; at: string } | null
}

type Unit = "PIECE" | "CARTON"

interface Line {
  id: string
  productId: string
  qty: string
  unit: Unit
  writtenAt: string
}

// ── Local storage (everything per link) ─────────────────────────────────────

const catKey = (t: string) => `lc-catalog-${t}`
// A recount round keeps its own lines, so the first round's lines are never re-sent.
const linesKey = (t: string, round = 0) => (round > 0 ? `lc-lines-${t}-r${round}` : `lc-lines-${t}`)
const pendingKey = (t: string) => `lc-pending-submit-${t}`
const doneKey = (t: string) => `lc-done-${t}`
// One id per upload round: a retry of the same upload reads as "already done",
// a different phone's upload is refused instead of silently dropped.
const submitIdKey = (t: string, round = 0) => `lc-submit-id-${t}-r${round}`
const deviceKey = "lc-device-id"

// A line bigger than this in pieces is a barcode typed into the quantity box.
const MAX_LINE_PIECES = 10_000_000

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Returns false when the write failed (storage full / blocked) so the page can warn. */
function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function removeKey(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* storage blocked */
  }
}

function isOfflineError(err: unknown) {
  return !(typeof err === "object" && err !== null && "response" in err && (err as { response?: unknown }).response)
}

function digitsOnly(v: string) {
  return v
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "")
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function deviceId() {
  const have = readJson<string | null>(deviceKey, null)
  if (have) return have
  const id = `dev-${newId()}`
  writeJson(deviceKey, id)
  return id
}

function submitIdFor(token: string, round: number) {
  const have = readJson<string | null>(submitIdKey(token, round), null)
  if (have) return have
  const id = `sub-${newId()}`
  writeJson(submitIdKey(token, round), id)
  return id
}

const toPayload = (lines: Line[]) =>
  lines.filter((l) => l.qty !== "").map((l) => ({ productId: l.productId, qty: Number(l.qty), unit: l.unit, writtenAt: l.writtenAt }))

const clock = (iso: string) => new Date(iso).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })

// ── Pictures ────────────────────────────────────────────────────────────────
// Small pictures are fetched a batch at a time and kept in the browser's cache
// storage, so they still show with no signal. The full picture opens on tap
// while online.

const THUMB_CACHE = "lc-thumbs-v1"
const thumbKey = (id: string) => `/__lc-thumb/${id}`

async function readCachedThumbs(ids: string[]) {
  const out = new Map<string, string>()
  try {
    const cache = await caches.open(THUMB_CACHE)
    await Promise.all(ids.map(async (id) => {
      const hit = await cache.match(thumbKey(id))
      if (hit) out.set(id, await hit.text())
    }))
  } catch {
    /* no cache storage (private mode) — pictures load online only */
  }
  return out
}

async function storeThumbs(entries: [string, string][]) {
  try {
    const cache = await caches.open(THUMB_CACHE)
    await Promise.all(entries.map(([id, url]) => cache.put(thumbKey(id), new Response(url))))
  } catch {
    /* storage full or blocked — still shown this session */
  }
}

function useThumbs(token: string, products: CatalogProduct[], online: boolean) {
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const wanted = useMemo(() => products.filter((p) => p.hasImage).map((p) => p.id), [products])
  useEffect(() => {
    let alive = true
    void (async () => {
      const cached = await readCachedThumbs(wanted)
      if (!alive) return
      setThumbs(new Map(cached))
      if (!online) return
      const missing = wanted.filter((id) => !cached.has(id))
      for (let i = 0; i < missing.length && alive; i += 100) {
        try {
          const { data } = await api.post(`/stocktake/public/lines/${token}/thumbnails`, { productIds: missing.slice(i, i + 100) }, { timeout: 60_000 })
          const got = Object.entries((data as { data: Record<string, string> }).data ?? {})
          if (!alive || got.length === 0) continue
          await storeThumbs(got)
          setThumbs((prev) => {
            const next = new Map(prev)
            for (const [id, url] of got) next.set(id, url)
            return next
          })
        } catch {
          break // offline again — the next open or reconnect continues
        }
      }
    })()
    return () => { alive = false }
  }, [token, wanted, online])
  return thumbs
}

function Thumb({ src, size = 44, onOpen }: { src: string | undefined; size?: number; onOpen?: () => void }) {
  const box = { width: size, height: size }
  if (!src)
    return (
      <span style={box} className="flex shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
        <ImageOff className="h-4 w-4" />
      </span>
    )
  return (
    <button
      type="button"
      style={box}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => { e.stopPropagation(); onOpen?.() }}
      className="shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
      aria-label="كبّر الصورة"
    >
      <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
    </button>
  )
}

/** Full-size picture over the page. Shows the small one at once, swaps in the
 * real one when it arrives; with no signal the small one stays. */
function ImageViewer({ token, product, thumb, online, onClose }: {
  token: string
  product: CatalogProduct
  thumb: string | undefined
  online: boolean
  onClose: () => void
}) {
  const [full, setFull] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!online) return
    let alive = true
    api
      .get(`/stocktake/public/lines/${token}/image/${product.id}`, { timeout: 60_000 })
      .then(({ data }) => { if (alive) setFull((data as { data: { image: string } }).data.image) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [token, product.id, online])
  const src = full ?? thumb
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white">
        <p className="min-w-0 truncate font-semibold">{product.name}</p>
        <button type="button" onClick={onClose} aria-label="سدّ" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        {src ? <img src={src} alt={product.name} className="max-h-full max-w-full object-contain" /> : <ImageOff className="h-12 w-12 text-white/40" />}
      </div>
      {!full && (
        <p className="pb-[max(env(safe-area-inset-bottom),12px)] text-center text-sm text-white/70">
          {!online || failed ? "بدون نت — هاي الصورة المصغرة" : "دا نحمّل الصورة الكاملة…"}
        </p>
      )}
    </div>
  )
}

function linePieces(line: Line, p: CatalogProduct | undefined) {
  const q = Number(line.qty || 0)
  return line.unit === "CARTON" ? q * Math.max(1, p?.pcsPerCarton ?? 1) : q
}

function describePieces(pieces: number, ppc: number) {
  const size = Math.max(1, ppc)
  if (size <= 1) return `${pieces} قطعة`
  const c = Math.floor(pieces / size)
  const r = pieces % size
  if (c === 0) return `${pieces} قطعة`
  return r > 0 ? `${pieces} قطعة (${c} كارتون + ${r})` : `${pieces} قطعة (${c} كارتون)`
}

// ── Page ────────────────────────────────────────────────────────────────────

export function PublicLineCountPage() {
  const { token = "" } = useParams<{ token: string }>()
  const [session, setSession] = useState<SessionData | null>(() => readJson<SessionData | null>(catKey(token), null))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!session)
  const round = session?.recountProductIds?.length ? (session.recountRound ?? 0) : 0
  const [lines, setLines] = useState<Line[]>(() => readJson<Line[]>(linesKey(token, round), []))
  // Which round the lines in state belong to. The round can change once the
  // fresh session arrives; until that round's lines are loaded nothing is
  // written, so one round's lines never land under another's key.
  const [linesRound, setLinesRound] = useState(round)
  const roundRef = useRef(round)
  useEffect(() => { roundRef.current = round }, [round])
  useEffect(() => {
    if (linesRound === round) return
    setLines(readJson<Line[]>(linesKey(token, round), []))
    setLinesRound(round)
  }, [round, linesRound, token])
  const [storageOk, setStorageOk] = useState(true)
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine))
  const [offlineReady, setOfflineReady] = useState(false)
  const [pendingSubmit, setPendingSubmit] = useState(() => readJson<boolean>(pendingKey(token), false))
  const [done, setDone] = useState(() => readJson<boolean>(doneKey(token), false))
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // Last time the server confirmed this phone's lines (a dead phone loses nothing).
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [seededFrom, setSeededFrom] = useState<{ count: number; at: string } | null>(null)
  const [viewing, setViewing] = useState<CatalogProduct | null>(null)
  const thumbs = useThumbs(token, session?.status === "OPEN" ? session.products : [], online)

  // Download (or refresh) the catalogue. A cached copy keeps the page usable offline.
  useEffect(() => {
    let cancelled = false
    api
      .get(`/stocktake/public/lines/${token}`)
      .then(({ data }) => {
        if (cancelled) return
        const fetched = (data as { data: SessionData }).data
        // A finished count comes back without the catalogue — keep the copy on
        // the phone so the written lines still show their product names.
        const cached = readJson<SessionData | null>(catKey(token), null)
        const s = fetched.products.length === 0 && cached ? { ...fetched, products: cached.products } : fetched
        // Sent back whole: the server's lines (with the manager's corrections)
        // replace this phone's old copy, or fill an empty one — another phone or
        // the office PC must never upload an empty list over the saved count.
        const saved = s.lines ?? []
        const toLines = (rows: { productId: string; qty: number; unit: Unit; writtenAt: string }[]) =>
          rows.map((l) => ({ id: newId(), productId: l.productId, qty: String(l.qty), unit: l.unit, writtenAt: l.writtenAt }))
        if (s.status === "OPEN" && !s.recountProductIds?.length && saved.length > 0) {
          const wasDone = readJson<boolean>(doneKey(token), false)
          if (wasDone || readJson<Line[]>(linesKey(token, 0), []).length === 0) {
            const seeded = toLines(saved)
            writeJson(linesKey(token, 0), seeded)
            setLines(seeded)
          }
        } else if (s.status === "OPEN" && s.draft && s.draft.lines.length > 0) {
          // This phone has nothing yet but another phone (or this one before its
          // storage was wiped) saved lines on the server — continue from them.
          const r = s.recountProductIds?.length ? (s.recountRound ?? 0) : 0
          if (readJson<Line[]>(linesKey(token, r), []).length === 0 && !readJson<boolean>(doneKey(token), false)) {
            const seeded = toLines(s.draft.lines)
            writeJson(linesKey(token, r), seeded)
            if (r === roundRef.current) setLines(seeded)
            setSeededFrom({ count: seeded.length, at: s.draft.at })
          }
        }
        // Lines and draft were only for seeding; the cached session never keeps them.
        const rest: SessionData = { ...s, lines: undefined, draft: undefined }
        setSession(rest)
        setLoadError(null)
        if (!writeJson(catKey(token), rest)) setStorageOk(false)
        if (s.status === "SUBMITTED" || s.status === "FINALIZED") {
          setDone(true)
          writeJson(doneKey(token), true)
        } else if (s.status === "OPEN" && readJson<boolean>(doneKey(token), false)) {
          // The manager sent it back («أعد للعامل») — the lines are still on
          // this phone, so let the worker fix them and upload again.
          removeKey(doneKey(token))
          setDone(false)
        }
      })
      .catch((err) => {
        if (cancelled) return
        if (!readJson<SessionData | null>(catKey(token), null)) {
          setLoadError(isOfflineError(err) ? "ماكو اتصال بالإنترنت — افتح الرابط أول مرة وانت متصل حتى تتحمّل المواد" : apiErrorMessage(err, "تعذر فتح الجرد"))
        }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [token])

  // Ask the browser not to evict our storage during a long offline shift.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined)
  }, [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off) }
  }, [])

  // The page itself reopens offline only once the service worker controls it.
  // The app registers the worker from the logged-in shell only, so this
  // no-login link must register it itself.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    void registerSW({ immediate: true })
    let alive = true
    void navigator.serviceWorker.ready.then(() => {
      if (!alive) return
      if (navigator.serviceWorker.controller) setOfflineReady(true)
      else navigator.serviceWorker.addEventListener("controllerchange", () => alive && setOfflineReady(true), { once: true })
    })
    return () => { alive = false }
  }, [])

  // Every change hits storage immediately — a dead battery loses nothing.
  useEffect(() => {
    if (linesRound !== round) return
    if (!writeJson(linesKey(token, linesRound), lines)) setStorageOk(false)
  }, [lines, token, round, linesRound])

  // Send the lines to the server while counting: a few seconds after each
  // change, when the page goes to the background, and when the signal returns.
  // Offline counting works exactly as before; this only adds a safety copy.
  const lastDraft = useRef("")
  const draftInFlight = useRef(false)
  const sendDraft = useCallback(async () => {
    if (done || session?.status !== "OPEN" || linesRound !== round || draftInFlight.current) return
    if (typeof navigator !== "undefined" && !navigator.onLine) return
    const payload = toPayload(readJson<Line[]>(linesKey(token, round), []))
    const body = JSON.stringify(payload)
    if (body === lastDraft.current) return
    draftInFlight.current = true
    try {
      const { data } = await api.post(`/stocktake/public/lines/${token}/draft`, { deviceId: deviceId(), round, lines: payload }, { timeout: 30_000 })
      if ((data as { data?: { saved?: boolean } })?.data?.saved) {
        lastDraft.current = body
        setSavedAt(new Date().toISOString())
      }
    } catch {
      /* the next change or the next minute tries again */
    } finally {
      draftInFlight.current = false
    }
  }, [done, session?.status, linesRound, round, token])

  useEffect(() => {
    const id = window.setTimeout(() => void sendDraft(), 4_000)
    return () => window.clearTimeout(id)
  }, [lines, sendDraft])

  useEffect(() => {
    const flush = () => { if (document.visibilityState === "hidden") void sendDraft() }
    const online = () => void sendDraft()
    document.addEventListener("visibilitychange", flush)
    window.addEventListener("online", online)
    const id = window.setInterval(() => void sendDraft(), 60_000)
    return () => {
      document.removeEventListener("visibilitychange", flush)
      window.removeEventListener("online", online)
      window.clearInterval(id)
    }
  }, [sendDraft])

  const inFlight = useRef(false)
  const submit = useCallback(async () => {
    // The online event, the retry timer and a tap can all fire together.
    if (inFlight.current) return
    inFlight.current = true
    const current = readJson<Line[]>(linesKey(token, round), [])
    const payload = toPayload(current)
    if (payload.length === 0) {
      inFlight.current = false
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await api.post(
        `/stocktake/public/lines/${token}/submit`,
        // sentAt lets the server correct a phone whose clock is wrong.
        { lines: payload, submitId: submitIdFor(token, round), sentAt: new Date().toISOString() },
        { timeout: 120_000 },
      )
      writeJson(doneKey(token), true)
      removeKey(pendingKey(token))
      setPendingSubmit(false)
      setDone(true)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? 0
      if (isOfflineError(err) || status >= 500 || status === 429) {
        // Keep it queued — retried automatically. A 5xx may even have saved it;
        // the server answers a repeat of the same upload with "already submitted".
        // 429 is the shop's shared connection being busy, not a real refusal.
        writeJson(pendingKey(token), true)
        setPendingSubmit(true)
      } else if (errorCodeOf(err) === "LINE_COUNT_ALREADY_SUBMITTED") {
        // Another phone uploaded first, or the manager closed the recount.
        // The lines stay on this phone so nothing is lost.
        removeKey(pendingKey(token))
        setPendingSubmit(false)
        setSubmitError(apiErrorMessage(err, "الجرد انرفع من موبايل ثاني — سطورك باقية بموبايلك. كلّم المدير."))
      } else {
        removeKey(pendingKey(token))
        setPendingSubmit(false)
        setSubmitError(apiErrorMessage(err, "ما انرفع الجرد"))
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }, [token, round])

  // Retry a queued upload whenever we might be back online.
  useEffect(() => {
    if (!pendingSubmit || done) return
    const tryNow = () => { if (navigator.onLine) void submit() }
    tryNow()
    window.addEventListener("online", tryNow)
    const id = window.setInterval(tryNow, 20_000)
    return () => { window.removeEventListener("online", tryNow); window.clearInterval(id) }
  }, [pendingSubmit, done, submit])

  const tooBig = (() => {
    const byId = new Map((session?.products ?? []).map((p) => [p.id, p]))
    const i = lines.findIndex((l) => linePieces(l, byId.get(l.productId)) > MAX_LINE_PIECES)
    return i < 0 ? null : { n: i + 1, qty: lines[i].qty }
  })()

  if (loading && !session)
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-24 text-slate-500">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p>دا نحمّل المواد…</p>
        </div>
      </Shell>
    )
  if (!session)
    return (
      <Shell>
        <p className="py-24 text-center font-medium text-red-600">{loadError ?? "تعذر فتح الجرد"}</p>
      </Shell>
    )
  if (session.status === "CANCELLED")
    return (
      <Shell>
        <p className="py-24 text-center font-medium text-slate-500">هذا الجرد ملغى.</p>
      </Shell>
    )
  if (done)
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-500" />
          <p className="text-xl font-bold">{session.status === "FINALIZED" ? "الجرد معتمد ✓" : "انرفع الجرد ✓"}</p>
          <p className="text-slate-500">
            {session.status === "FINALIZED" ? "المدير راجع الجرد واعتمده." : "بانتظار مراجعة المدير. تكدر تسدّ الصفحة."}
          </p>
        </div>
      </Shell>
    )

  return (
    <Shell>
      <header className="mb-3">
        <h1 className="text-lg font-bold">جرد {session.warehouseName}</h1>
        {session.notes && <p className="text-sm text-slate-500">{session.notes}</p>}
        {round > 0 && (
          <p className="mt-2 rounded-xl bg-violet-50 px-3 py-2 text-sm font-medium text-violet-800">
            المدير يريد تعيد عدّ {session.products.length} مادة بس. اعدّها واكتبها من جديد — إذا ماكو منها شي اكتب 0. المواد اللي ما تكتبها تبقى على عدّك القديم.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold", online ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800")}>
            {online ? <Wifi className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {online ? "متصل" : "بدون نت — كمّل عادي"}
          </span>
          <span className={cn("rounded-full px-2.5 py-1 font-semibold", offlineReady ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
            {offlineReady ? `✓ ${session.products.length} مادة محمّلة — يشتغل بدون نت` : "دا يجهّز الشغل بدون نت… خلّيه متصل شوية"}
          </span>
        </div>
        {!storageOk && (
          <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            المتصفح ما دا يحفظ السطور على الجهاز (وضع خاص أو الذاكرة مليانة). لا تسدّ الصفحة قبل الرفع.
          </p>
        )}
        {seededFrom && (
          <p className="mt-2 rounded-xl bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800">
            كمّلنا من {seededFrom.count} سطر محفوظة بالسيرفر (آخر حفظ {clock(seededFrom.at)}). راجعها وكمّل عليها.
          </p>
        )}
        {savedAt && lines.length > 0 && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <CloudUpload className="h-3.5 w-3.5" /> السطور محفوظة بالسيرفر — آخر حفظ {clock(savedAt)}
          </p>
        )}
      </header>

      <LineEditor
        products={session.products}
        lines={lines}
        setLines={setLines}
        thumbs={thumbs}
        recount={round > 0}
        onOpenImage={setViewing}
      />
      {viewing && (
        <ImageViewer token={token} product={viewing} thumb={thumbs.get(viewing.id)} online={online} onClose={() => setViewing(null)} />
      )}

      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        {pendingSubmit && (
          <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            الجرد جاهز للرفع — راح ينرفع وحده أول ما يرجع النت. لا تحذف الصفحة.
          </p>
        )}
        {submitError && <p role="alert" className="mb-2 text-sm font-medium text-red-600">{submitError}</p>}
        {tooBig && (
          <p role="alert" className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            سطر {tooBig.n}: العدد {tooBig.qty} كبير جداً — يمكن انقرأ باركود بخانة العدد. صحّحه قبل الرفع.
          </p>
        )}
        <button
          type="button"
          disabled={submitting || lines.length === 0 || lines.some((l) => l.qty === "") || !!tooBig}
          onClick={() => {
            if (lines.some((l) => l.qty === "") || tooBig) return
            if (confirm(`رفع الجرد (${lines.length} سطر)؟ بعد الرفع ما تكدر تعدّل.`)) void submit()
          }}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-lg font-bold text-white disabled:opacity-40"
        >
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
          {pendingSubmit ? "ينتظر النت…" : `رفع الجرد (${lines.length} سطر)`}
        </button>
        {lines.some((l) => l.qty === "") && (
          <p className="mt-1 text-center text-xs text-red-600">اكو سطر بلا كمية — اكتبها أو احذف السطر</p>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-xl px-4 pt-4">{children}</div>
    </div>
  )
}

// ── Line editor ─────────────────────────────────────────────────────────────

function LineEditor({
  products,
  lines,
  setLines,
  thumbs,
  recount,
  onOpenImage,
}: {
  products: CatalogProduct[]
  lines: Line[]
  setLines: React.Dispatch<React.SetStateAction<Line[]>>
  thumbs: Map<string, string>
  recount: boolean
  onOpenImage: (p: CatalogProduct) => void
}) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<CatalogProduct | null>(null)
  const [qty, setQty] = useState("")
  const [unit, setUnit] = useState<Unit>("PIECE")
  const [notFound, setNotFound] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const qtyRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = query.trim()
    if (!q || picked) return []
    return products
      .map((p) => ({ p, score: scoreProduct({ name: p.name, itemNumber: p.itemNumber ?? "", qrCode: p.qrCode, cartonQrCode: p.cartonQrCode, category: p.category }, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.p)
  }, [products, query, picked])

  function pick(p: CatalogProduct, asUnit: Unit = "PIECE") {
    setNotFound(null)
    setPicked(p)
    setQuery(p.name)
    setUnit(p.pcsPerCarton > 1 ? asUnit : "PIECE")
    setTimeout(() => qtyRef.current?.focus(), 0)
  }

  // A barcode scanner types the code then Enter — match it exactly first,
  // tolerating an Arabic keyboard layout that garbles the scan. A carton
  // barcode picks the carton unit.
  function onSearchEnter() {
    const q = query.trim()
    if (!q) return
    const hit = findProductByScan(
      products.map((p) => ({ ...p, itemNumber: p.itemNumber ?? "" })),
      q,
    )
    if (hit) {
      const p = products.find((x) => x.id === hit.product.id)
      if (p) return pick(p, hit.isCarton ? "CARTON" : "PIECE")
    }
    // A code (digits, or a long run of Latin letters/digits) that matches
    // nothing must not silently pick the nearest-looking product.
    if (/^[0-9-]+$/.test(q) || /^[0-9A-Za-z-]{6,}$/.test(q)) {
      setNotFound(q)
      return
    }
    if (results.length > 0) pick(results[0])
  }

  function reset() {
    setPicked(null)
    setQuery("")
    setQty("")
    setUnit("PIECE")
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  function addLine() {
    if (!picked || qty === "") return
    if ((unit === "CARTON" ? Number(qty) * Math.max(1, picked.pcsPerCarton) : Number(qty)) > MAX_LINE_PIECES) {
      alert(`العدد ${qty} كبير جداً — يمكن انقرأ باركود بخانة العدد. اكتب الكمية من جديد.`)
      setQty("")
      return
    }
    if (!confirmBigQty(Number(qty), unit, picked.pcsPerCarton)) return
    setLines((prev) => [...prev, { id: newId(), productId: picked.id, qty, unit, writtenAt: new Date().toISOString() }])
    reset()
  }

  // Same product written on earlier lines: «مكتوبة بسطر 3 — المجموع 12».
  const earlier = picked ? lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => x.l.productId === picked.id) : []
  const earlierTotal = earlier.reduce((t, x) => t + linePieces(x.l, picked ?? undefined), 0)

  // Totals per product across every line, for the duplicate badge on each row.
  const totals = useMemo(() => {
    const m = new Map<string, { pieces: number; count: number }>()
    for (const l of lines) {
      const cur = m.get(l.productId) ?? { pieces: 0, count: 0 }
      cur.pieces += linePieces(l, byId.get(l.productId))
      cur.count += 1
      m.set(l.productId, cur)
    }
    return m
  }, [lines, byId])

  // Changing a line is a fresh look at the shelf, so its time moves to now —
  // the server compares it with the stock at that moment.
  const update = (id: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch, writtenAt: new Date().toISOString() } : l)))

  return (
    <div className="space-y-3">
      {/* New line */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPicked(null); setNotFound(null) }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchEnter() } }}
            placeholder="اسم المادة أو رقمها أو الباركود"
            autoComplete="off"
            enterKeyHint="search"
            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pr-10 pl-3 text-base outline-none focus:border-emerald-400 focus:bg-white"
          />
          {notFound && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              ما لگينا مادة بهذا الرقم أو الباركود: <span dir="ltr" className="font-mono">{notFound}</span> — ابحث بالاسم.
            </p>
          )}
          {results.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-right hover:bg-slate-50 active:bg-slate-100"
                  >
                    <Thumb src={thumbs.get(p.id)} size={40} onOpen={() => onOpenImage(p)} />
                    <span className="min-w-0">
                      <span className="block font-medium">{p.name}</span>
                      <span className="block text-xs text-slate-400">
                        {p.itemNumber ? <span dir="ltr" className="font-mono">{p.itemNumber}</span> : null}
                        {p.category ? ` · ${p.category}` : ""}
                        {totals.has(p.id) ? " · مكتوبة سابقاً" : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {picked && (
          <div className="mt-3 space-y-2">
            {thumbs.get(picked.id) && (
              <div className="flex items-center gap-3">
                <Thumb src={thumbs.get(picked.id)} size={72} onOpen={() => onOpenImage(picked)} />
                <p className="text-xs text-slate-500">اضغط الصورة حتى تكبر وتتأكد إنها نفس المادة.</p>
              </div>
            )}
            {earlier.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
                مكتوبة بسطر {earlier.map((x) => x.n).join("، ")} — المجموع لحد الآن {describePieces(earlierTotal, picked.pcsPerCarton)}. السطر الجديد ينضاف عليها.
              </p>
            )}
            <div className="flex items-stretch gap-2">
              <input
                ref={qtyRef}
                value={qty}
                onChange={(e) => setQty(digitsOnly(e.target.value))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine() } }}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                enterKeyHint="done"
                autoComplete="off"
                placeholder="الكمية"
                dir="ltr"
                className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-lg font-semibold tabular-nums outline-none focus:border-emerald-400 focus:bg-white"
              />
              {picked.pcsPerCarton > 1 && (
                <UnitToggle unit={unit} ppc={picked.pcsPerCarton} onChange={(u) => { setUnit(u); qtyRef.current?.focus() }} />
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={addLine} disabled={qty === ""} className="h-12 flex-1 rounded-xl bg-slate-900 text-base font-bold text-white disabled:opacity-40">
                إضافة السطر
              </button>
              <button type="button" onClick={reset} className="h-12 rounded-xl border border-slate-200 px-4 text-slate-600">
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>

      <ProductBrowser
        products={products}
        totals={totals}
        thumbs={thumbs}
        recount={recount}
        onPick={(p) => { pick(p); window.scrollTo({ top: 0, behavior: "smooth" }) }}
        onOpenImage={onOpenImage}
      />

      {/* Written lines — newest on top so the last entry is always in view */}
      {lines.length === 0 ? (
        <p className="py-8 text-center text-slate-400">ابحث عن مادة واكتب كميتها — كل مادة بسطر.</p>
      ) : (
        <ol className="space-y-2">
          {lines.map((l, i) => ({ l, n: i + 1 })).reverse().map(({ l, n }) => {
            const p = byId.get(l.productId)
            const t = totals.get(l.productId)
            return (
              <li key={l.id} className={cn("rounded-2xl border bg-white p-3 shadow-sm", l.qty === "" ? "border-red-300" : "border-slate-200")}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  {p && <Thumb src={thumbs.get(p.id)} size={40} onOpen={() => onOpenImage(p)} />}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug">
                      <span className="ml-1 text-slate-400">{n}.</span>
                      {p?.name ?? "مادة غير معروفة"}
                    </p>
                    {t && t.count > 1 && (
                      <p className="mt-0.5 text-xs font-medium text-amber-700">
                        مكتوبة {t.count} مرات — المجموع {describePieces(t.pieces, p?.pcsPerCarton ?? 1)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="حذف السطر"
                    onClick={() => { if (confirm(`حذف سطر ${n}؟`)) setLines((prev) => prev.filter((x) => x.id !== l.id)) }}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-red-500 active:bg-red-50"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex items-stretch gap-2">
                  <input
                    value={l.qty}
                    onChange={(e) => update(l.id, { qty: digitsOnly(e.target.value) })}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    dir="ltr"
                    aria-label={`كمية سطر ${n}`}
                    className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-base font-semibold tabular-nums outline-none focus:border-emerald-400 focus:bg-white"
                  />
                  {p && p.pcsPerCarton > 1 && <UnitToggle unit={l.unit} ppc={p.pcsPerCarton} onChange={(u) => update(l.id, { unit: u })} />}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** Every product the link covers, with its picture and whether it's written
 * yet — the worker can walk the list instead of searching. Tapping a product
 * starts its line; tapping the picture enlarges it. During a recount it opens
 * by itself and lists just the products asked for. */
function ProductBrowser({
  products,
  totals,
  thumbs,
  recount,
  onPick,
  onOpenImage,
}: {
  products: CatalogProduct[]
  totals: Map<string, { pieces: number; count: number }>
  thumbs: Map<string, string>
  recount: boolean
  onPick: (p: CatalogProduct) => void
  onOpenImage: (p: CatalogProduct) => void
}) {
  const [open, setOpen] = useState(recount)
  const [onlyLeft, setOnlyLeft] = useState(false)
  const [category, setCategory] = useState("")
  const [shown, setShown] = useState(40)
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, "ar")), [products])
  const list = useMemo(
    () => products.filter((p) => (!onlyLeft || !totals.has(p.id)) && (!category || p.category === category)),
    [products, onlyLeft, category, totals],
  )
  const done = products.filter((p) => totals.has(p.id)).length
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-3 text-right">
        <span className="font-semibold">
          {recount ? "المواد المطلوب تعيد عدّها" : "تصفّح المواد"} ({products.length})
          <span className="mr-2 text-xs font-medium text-emerald-700">انكتبت {done} · باقي {products.length - done}</span>
        </span>
        <ChevronDown className={cn("h-5 w-5 text-slate-400 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 p-3">
          <div className="flex flex-wrap gap-2">
            {categories.length > 1 && (
              <select
                value={category}
                onChange={(e) => { setCategory(e.target.value); setShown(40) }}
                className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm"
              >
                <option value="">كل الأقسام</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <label className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm">
              <input type="checkbox" checked={onlyLeft} onChange={(e) => { setOnlyLeft(e.target.checked); setShown(40) }} className="h-4 w-4" />
              الباقية بس
            </label>
          </div>
          {list.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">{onlyLeft ? "كل المواد انكتبت ✓" : "ماكو مواد"}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {list.slice(0, shown).map((p) => {
                const t = totals.get(p.id)
                return (
                  <li key={p.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => onPick(p)}
                      onKeyDown={(e) => { if (e.key === "Enter") onPick(p) }}
                      className="flex items-center gap-3 py-2 active:bg-slate-50"
                    >
                      <Thumb src={thumbs.get(p.id)} size={56} onOpen={() => onOpenImage(p)} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium leading-snug">{p.name}</span>
                        <span className="block text-xs text-slate-400">
                          {p.itemNumber ? <span dir="ltr" className="font-mono">{p.itemNumber}</span> : null}
                          {p.category ? ` · ${p.category}` : ""}
                        </span>
                      </span>
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", t ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                        {t ? `✓ ${describePieces(t.pieces, p.pcsPerCarton)}` : "ما انكتبت"}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {list.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + 40)} className="h-11 w-full rounded-xl border border-slate-200 text-sm font-semibold text-slate-600">
              عرض المزيد ({list.length - shown} باقية)
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** A typo like 300 cartons for 3 is caught here, while the worker still
 * stands at the shelf. Thresholds are deliberately loose — only clearly
 * unusual numbers ask. The worker never sees the system stock. */
function confirmBigQty(qty: number, unit: Unit, ppc: number) {
  const size = Math.max(1, ppc)
  const pieces = unit === "CARTON" ? qty * size : qty
  const big = unit === "CARTON" ? qty >= 50 : qty >= 500
  if (!big) return true
  const as = unit === "CARTON" ? `${qty} كارتون = ${pieces} قطعة` : size > 1 ? `${qty} قطعة (≈ ${Math.floor(qty / size)} كارتون)` : `${qty} قطعة`
  return confirm(`رقم كبير: ${as}
متأكد من الكمية والوحدة؟`)
}

function UnitToggle({ unit, ppc, onChange }: { unit: Unit; ppc: number; onChange: (u: Unit) => void }) {
  return (
    <div className="flex shrink-0 rounded-xl bg-slate-100 p-0.5">
      {(["PIECE", "CARTON"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(u)}
          className={cn("rounded-lg px-3 text-sm font-semibold transition", unit === u ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
        >
          {u === "PIECE" ? "قطعة" : `كارتون (${ppc})`}
        </button>
      ))}
    </div>
  )
}
