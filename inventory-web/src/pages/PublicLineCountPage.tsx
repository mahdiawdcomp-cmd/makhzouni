// «جرد بالسطور» — worker link. Written like an invoice without prices: pick a
// product, type the quantity, next line. The whole catalogue is downloaded on
// first open and every line lives in localStorage, so the worker can count for
// hours with no signal, close the tab, reopen it, and upload at the end. The
// upload itself retries on its own until the server confirms it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { registerSW } from "virtual:pwa-register"
import { CheckCircle2, CloudOff, Loader2, Search, Trash2, Wifi } from "lucide-react"
import { api } from "../api/client"
import { cn } from "../utils/cn"
import { apiErrorMessage } from "../utils/apiError"
import { scoreProduct } from "../utils/search"

interface CatalogProduct {
  id: string
  name: string
  itemNumber: string | null
  qrCode: string | null
  cartonQrCode: string | null
  category: string | null
  pcsPerCarton: number
}

interface SessionData {
  id: string
  status: string
  notes: string | null
  warehouseName: string
  createdAt: string
  products: CatalogProduct[]
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
const linesKey = (t: string) => `lc-lines-${t}`
const pendingKey = (t: string) => `lc-pending-submit-${t}`
const doneKey = (t: string) => `lc-done-${t}`

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
  const [lines, setLines] = useState<Line[]>(() => readJson<Line[]>(linesKey(token), []))
  const [storageOk, setStorageOk] = useState(true)
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine))
  const [offlineReady, setOfflineReady] = useState(false)
  const [pendingSubmit, setPendingSubmit] = useState(() => readJson<boolean>(pendingKey(token), false))
  const [done, setDone] = useState(() => readJson<boolean>(doneKey(token), false))
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Download (or refresh) the catalogue. A cached copy keeps the page usable offline.
  useEffect(() => {
    let cancelled = false
    api
      .get(`/stocktake/public/lines/${token}`)
      .then(({ data }) => {
        if (cancelled) return
        const s = (data as { data: SessionData }).data
        setSession(s)
        setLoadError(null)
        if (!writeJson(catKey(token), s)) setStorageOk(false)
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
    if (!writeJson(linesKey(token), lines)) setStorageOk(false)
  }, [lines, token])

  const inFlight = useRef(false)
  const submit = useCallback(async () => {
    // The online event, the retry timer and a tap can all fire together.
    if (inFlight.current) return
    inFlight.current = true
    const current = readJson<Line[]>(linesKey(token), [])
    const payload = current
      .filter((l) => l.qty !== "")
      .map((l) => ({ productId: l.productId, qty: Number(l.qty), unit: l.unit, writtenAt: l.writtenAt }))
    if (payload.length === 0) {
      inFlight.current = false
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await api.post(`/stocktake/public/lines/${token}/submit`, { lines: payload }, { timeout: 120_000 })
      writeJson(doneKey(token), true)
      removeKey(pendingKey(token))
      setPendingSubmit(false)
      setDone(true)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status ?? 0
      if (isOfflineError(err) || status >= 500) {
        // Keep it queued — retried automatically. A 5xx may even have saved it;
        // the server answers a repeat with "already submitted".
        writeJson(pendingKey(token), true)
        setPendingSubmit(true)
      } else {
        removeKey(pendingKey(token))
        setPendingSubmit(false)
        setSubmitError(apiErrorMessage(err, "ما انرفع الجرد"))
      }
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }, [token])

  // Retry a queued upload whenever we might be back online.
  useEffect(() => {
    if (!pendingSubmit || done) return
    const tryNow = () => { if (navigator.onLine) void submit() }
    tryNow()
    window.addEventListener("online", tryNow)
    const id = window.setInterval(tryNow, 20_000)
    return () => { window.removeEventListener("online", tryNow); window.clearInterval(id) }
  }, [pendingSubmit, done, submit])

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
      </header>

      <LineEditor products={session.products} lines={lines} setLines={setLines} />

      <div className="sticky bottom-0 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        {pendingSubmit && (
          <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            الجرد جاهز للرفع — راح ينرفع وحده أول ما يرجع النت. لا تحذف الصفحة.
          </p>
        )}
        {submitError && <p role="alert" className="mb-2 text-sm font-medium text-red-600">{submitError}</p>}
        <button
          type="button"
          disabled={submitting || lines.length === 0 || lines.some((l) => l.qty === "")}
          onClick={() => {
            if (lines.some((l) => l.qty === "")) return
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
}: {
  products: CatalogProduct[]
  lines: Line[]
  setLines: React.Dispatch<React.SetStateAction<Line[]>>
}) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<CatalogProduct | null>(null)
  const [qty, setQty] = useState("")
  const [unit, setUnit] = useState<Unit>("PIECE")
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
    setPicked(p)
    setQuery(p.name)
    setUnit(p.pcsPerCarton > 1 ? asUnit : "PIECE")
    setTimeout(() => qtyRef.current?.focus(), 0)
  }

  // A barcode scanner types the code then Enter — match it exactly first.
  function onSearchEnter() {
    const q = query.trim()
    if (!q) return
    const carton = products.find((p) => p.cartonQrCode && p.cartonQrCode === q)
    if (carton) return pick(carton, "CARTON")
    const exact = products.find((p) => p.qrCode === q || p.itemNumber === q)
    if (exact) return pick(exact)
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

  const update = (id: string, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  return (
    <div className="space-y-3">
      {/* New line */}
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPicked(null) }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSearchEnter() } }}
            placeholder="اسم المادة أو رقمها أو الباركود"
            autoComplete="off"
            enterKeyHint="search"
            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pr-10 pl-3 text-base outline-none focus:border-emerald-400 focus:bg-white"
          />
          {results.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                    className="block w-full px-3 py-2.5 text-right hover:bg-slate-50 active:bg-slate-100"
                  >
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs text-slate-400">
                      {p.itemNumber ? <span dir="ltr" className="font-mono">{p.itemNumber}</span> : null}
                      {p.category ? ` · ${p.category}` : ""}
                      {totals.has(p.id) ? " · مكتوبة سابقاً" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {picked && (
          <div className="mt-3 space-y-2">
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
                  <div className="min-w-0">
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
