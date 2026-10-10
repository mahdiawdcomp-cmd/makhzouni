import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { CheckCircle2, Package, ScanLine, ClipboardList, Search, X, Minus, Plus, Loader2 } from "lucide-react"
import { api } from "../api/client"
import { cn } from "../utils/cn"
import { apiErrorMessage } from "../utils/apiError"
import { scoreProduct } from "../utils/search"

// The worker's count link. Mostly opened on a phone (iPhone Safari), so:
// - every input is ≥16px — anything smaller makes iOS zoom the page on focus
//   and leave it zoomed;
// - tap targets are ≥44px;
// - the fixed submit bar clears the home indicator (safe-area inset);
// - manual entry with search is the default — the scan tab is for a barcode
//   gun, which a phone does not have.

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublicItem {
  id: string
  productId: string
  productName: string
  itemNumber?: string | null
  category: string | null
  qrCode: string | null
  cartonQrCode: string | null
  pcsPerCarton: number
  actualQty: number | null
}

interface PublicSession {
  id: string
  status: string
  notes: string | null
  branch: { name: string } | null
  createdAt: string
  items: PublicItem[]
}

type Mode = "scan" | "manual"
type Unit = "CARTON" | "PIECE"
type CountFilter = "all" | "todo" | "done"

const MODE_KEY = "stocktake-worker-mode"
const UNCATEGORIZED = "غير مصنّف"

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchSession(token: string): Promise<PublicSession> {
  const { data } = await api.get(`/stocktake/public/${token}`)
  return (data as { data: PublicSession }).data
}

async function apiScan(token: string, qrCode: string) {
  const { data } = await api.post(`/stocktake/public/${token}/scan`, { qrCode })
  return (data as { data: { productId: string; productName: string; newQty: number; category: string | null } }).data
}

async function apiSetQty(token: string, productId: string, qty: number, unit: Unit, pcsPerCarton: number) {
  const { data } = await api.put(`/stocktake/public/${token}/item`, { productId, qty, unit, pcsPerCarton })
  return data
}

async function apiSubmit(token: string) {
  const { data } = await api.post(`/stocktake/public/${token}/submit`)
  return data
}

async function apiClose(token: string) {
  const { data } = await api.post(`/stocktake/public/${token}/close`)
  return data
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "240 قطعة · 12 كارتون" — the saved count in the words the worker counted in. */
function describeQty(pieces: number, pcsPerCarton: number) {
  const ppc = Math.max(1, pcsPerCarton)
  if (ppc <= 1) return `${pieces} قطعة`
  const cartons = Math.floor(pieces / ppc)
  const loose = pieces % ppc
  const parts = [`${pieces} قطعة`]
  if (cartons > 0) parts.push(loose > 0 ? `${cartons} كارتون + ${loose}` : `${cartons} كارتون`)
  return parts.join(" · ")
}

/**
 * The server's own message when it answered; otherwise (no signal in the
 * warehouse, Wi-Fi dropped) a plain Arabic line — axios would say "Network Error".
 */
function workerError(err: unknown, fallback: string) {
  const answered = typeof err === "object" && err !== null && "response" in err && (err as { response?: unknown }).response
  return answered ? apiErrorMessage(err, fallback) : `${fallback} (ماكو اتصال بالإنترنت)`
}

/** Gives the page iOS safe-area insets (env(safe-area-inset-*)) while mounted. */
function useViewportFitCover() {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!meta) return
    const original = meta.content
    if (!original.includes("viewport-fit")) meta.content = `${original}, viewport-fit=cover`
    return () => { meta.content = original }
  }, [])
}

function isTouchDevice() {
  try {
    return window.matchMedia("(pointer: coarse)").matches
  } catch {
    return false
  }
}

function readMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === "scan" || saved === "manual") return saved
  } catch {
    // storage blocked — fall through to the device default
  }
  return isTouchDevice() ? "manual" : "scan"
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function PublicStocktakePage() {
  const { token } = useParams<{ token: string }>()
  useViewportFitCover()
  const sessionQ = useQuery({
    queryKey: ["public-stocktake", token],
    queryFn: () => fetchSession(token!),
    enabled: Boolean(token),
    staleTime: 30_000,
    // Several workers usually count the same session — keep everyone's
    // progress and the «تم» marks current.
    refetchInterval: 30_000,
  })

  if (sessionQ.isLoading)
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50" dir="rtl">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Package className="h-10 w-10 animate-pulse" />
          <p className="text-base">جاري التحميل...</p>
        </div>
      </div>
    )

  if (sessionQ.isError || !sessionQ.data)
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="rounded-2xl bg-white p-8 shadow text-center max-w-sm">
          <p className="text-2xl mb-2">⚠️</p>
          <p className="font-bold text-lg">رابط غير صحيح</p>
          <p className="text-slate-500 text-sm mt-2">تأكد من الرابط وحاول مرة أخرى.</p>
        </div>
      </div>
    )

  const session = sessionQ.data
  if (session.status === "CLOSED")
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="rounded-2xl bg-white p-8 shadow text-center max-w-sm">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
          <p className="font-bold text-xl">تم إغلاق الجرد</p>
          <p className="text-slate-500 text-sm mt-2">هذه الجلسة أُغلقت من قِبل الإدارة.</p>
        </div>
      </div>
    )

  return <WorkerInterface token={token!} session={session} onRefresh={() => void sessionQ.refetch()} />
}

// ── Worker Interface ──────────────────────────────────────────────────────────

function WorkerInterface({
  token,
  session,
  onRefresh,
}: {
  token: string
  session: PublicSession
  onRefresh: () => void
}) {
  const [mode, setModeState] = useState<Mode>(readMode)
  const [submitted, setSubmitted] = useState(session.status === "SUBMITTED")
  const [closed, setClosed] = useState(false)
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [query, setQuery] = useState("")

  function setMode(next: Mode) {
    setModeState(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // storage blocked — the choice still holds for this visit
    }
  }

  const submitMut = useMutation({
    mutationFn: () => apiSubmit(token),
    onSuccess: () => setSubmitted(true),
    onError: (err) => alert(workerError(err, "تعذر رفع الجرد — حاول مرة ثانية.")),
  })

  // "Close" now SUBMITS when counted variances are still unreviewed — closing
  // outright made them permanently unapprovable, silently discarding the count.
  // Tell the worker which of the two actually happened.
  const [closeStatus, setCloseStatus] = useState<"CLOSED" | "SUBMITTED">("CLOSED")
  const closeMut = useMutation({
    mutationFn: () => apiClose(token),
    onSuccess: (res) => {
      setCloseStatus(res?.data?.status === "SUBMITTED" ? "SUBMITTED" : "CLOSED")
      setClosed(true)
    },
    onError: (err) => alert(workerError(err, "تعذر إغلاق الجرد — حاول مرة ثانية.")),
  })

  const total = session.items.length
  const filled = session.items.filter((i) => i.actualQty !== null).length
  const remaining = total - filled
  const percent = total > 0 ? Math.round((filled / total) * 100) : 0

  if (closed)
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="rounded-2xl bg-white p-8 shadow text-center max-w-sm w-full">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
          <p className="font-bold text-xl">
            {closeStatus === "SUBMITTED" ? "تم إرسال الجرد للإدارة" : "تم إغلاق الجرد"}
          </p>
          <p className="text-slate-500 text-sm mt-2">
            {closeStatus === "SUBMITTED"
              ? "فروقاتك بانتظار مراجعة الإدارة."
              : "لا يمكن إجراء تعديلات بعد الإغلاق."}
          </p>
        </div>
      </div>
    )

  if (submitted)
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="rounded-2xl bg-white p-8 shadow text-center max-w-sm w-full">
          <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto mb-4" />
          <p className="font-bold text-2xl text-emerald-700">تم رفع الجرد!</p>
          <p className="text-slate-500 text-sm mt-2">سيراجع المسؤول النتائج وسيتواصل معك عند الحاجة.</p>
          <button
            type="button"
            disabled={closeMut.isPending}
            onClick={() => {
              if (confirm("إغلاق الجرد نهائياً؟ لن يقبل الرابط أي تعديلات بعد الإغلاق."))
                closeMut.mutate()
            }}
            className="mt-5 h-12 w-full rounded-xl bg-slate-900 text-base font-bold text-white disabled:opacity-50"
          >
            {closeMut.isPending ? "جاري الإغلاق..." : "🔒 إغلاق الجرد"}
          </button>
        </div>
      </div>
    )

  return (
    <div className="min-h-[100dvh] bg-slate-50" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b bg-white/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] shadow-sm backdrop-blur">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold">جرد المخزن</p>
              <p className="truncate text-xs text-slate-500">
                {session.branch?.name ?? "المخزن الرئيسي"}
                {session.notes ? ` · ${session.notes}` : ""}
              </p>
            </div>
            <div
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-sm font-bold tabular-nums",
                remaining === 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700",
              )}
            >
              {filled}/{total}
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
          </div>

          {/* Mode toggle */}
          <div className="mt-3 flex gap-1 rounded-xl bg-slate-100 p-1">
            {([
              { key: "manual", label: "إدخال يدوي", Icon: ClipboardList },
              { key: "scan", label: "مسح باركود", Icon: ScanLine },
            ] as const).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={cn(
                  "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition",
                  mode === key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                )}
              >
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          {/* Search stays in the sticky header — reachable from deep in a long list */}
          {mode === "manual" && (
            <div className="mt-3">
              <div className="relative">
                <Search className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث بالاسم أو رقم المادة أو الباركود"
                  aria-label="بحث"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-11 text-base shadow-sm outline-none focus:border-emerald-400 [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="مسح البحث"
                    className="absolute left-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 active:bg-slate-100"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-4">
        {mode === "scan" ? (
          <ScanMode
            token={token}
            items={session.items}
            msg={scanMsg}
            onScan={(msg) => { setScanMsg(msg); onRefresh() }}
          />
        ) : (
          <ManualMode token={token} items={session.items} query={query} onSaved={onRefresh} />
        )}
      </div>

      {/* Submit button — clears the iPhone home indicator */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <div className="mx-auto max-w-2xl">
          <button
            type="button"
            disabled={submitMut.isPending || filled === 0}
            onClick={() => {
              const warn = remaining > 0 ? `\nباقي ${remaining} منتج ما انحسب.` : ""
              if (confirm(`هل أنت متأكد من رفع الجرد؟ لن تتمكن من التعديل بعدها.${warn}`))
                submitMut.mutate()
            }}
            className="h-12 w-full rounded-xl bg-emerald-600 text-base font-bold text-white shadow-md transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitMut.isPending ? "جاري الرفع..." : `✅ رفع الجرد (${filled} منتج)`}
          </button>
          {remaining > 0 && filled > 0 && (
            <p className="mt-1.5 text-center text-xs text-slate-400">
              باقي {remaining} منتج ما انحسب بعد
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Scan Mode ─────────────────────────────────────────────────────────────────

function ScanMode({
  token,
  items,
  msg,
  onScan,
}: {
  token: string
  items: PublicItem[]
  msg: { text: string; ok: boolean } | null
  onScan: (msg: { text: string; ok: boolean }) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [localInput, setLocalInput] = useState("")

  // Auto-focus so a barcode gun types straight in. (iOS ignores focus without
  // a tap, so this never pops the phone keyboard on its own.)
  useEffect(() => { inputRef.current?.focus() }, [])

  const scanMut = useMutation({
    mutationFn: (qr: string) => apiScan(token, qr),
    onSuccess: (d) => {
      const item = items.find((i) => i.productId === d.productId)
      // newQty is the running total in PIECES (a carton barcode adds a whole carton).
      onScan({ text: `✓ ${d.productName} — ${describeQty(d.newQty, item?.pcsPerCarton ?? 1)}`, ok: true })
      setLocalInput("")
      setTimeout(() => inputRef.current?.focus(), 100)
    },
    onError: (e: unknown) => {
      onScan({ text: `✗ ${workerError(e, "تعذر التسجيل")}`, ok: false })
      setLocalInput("")
      setTimeout(() => inputRef.current?.focus(), 100)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (localInput.trim()) scanMut.mutate(localInput.trim())
  }

  const scanned = items.filter((i) => i.actualQty !== null)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <p className="mb-3 font-semibold">وجّه مسدس الباركود نحو الكارتون</p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            placeholder="امسح الباركود أو اكتبه..."
            className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-base outline-none focus:border-emerald-400 focus:bg-white"
            dir="ltr"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button
            type="submit"
            disabled={scanMut.isPending || !localInput.trim()}
            className="mt-2 h-12 w-full rounded-xl bg-slate-900 text-base font-bold text-white disabled:opacity-50"
          >
            {scanMut.isPending ? "..." : "تسجيل"}
          </button>
        </form>

        {msg && (
          <div
            role="status"
            className={cn(
              "mt-3 rounded-xl px-4 py-3 text-sm font-medium",
              msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
            )}
          >
            {msg.text}
          </div>
        )}
      </div>

      {scanned.length > 0 && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold">المنتجات المحسوبة ({scanned.length})</p>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {scanned.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2">
                <span className="min-w-0 text-sm font-medium">{item.productName}</span>
                <span className="shrink-0 rounded-full bg-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  {describeQty(item.actualQty ?? 0, item.pcsPerCarton)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Manual Mode ───────────────────────────────────────────────────────────────

type SaveState = { status: "saving" } | { status: "error"; message: string }

function ManualMode({
  token,
  items,
  query,
  onSaved,
}: {
  token: string
  items: PublicItem[]
  query: string
  onSaved: () => void
}) {
  const [countFilter, setCountFilter] = useState<CountFilter>("all")
  const [category, setCategory] = useState<string>("all")
  const [localQty, setLocalQty] = useState<Record<string, string>>({})
  const [localUnit, setLocalUnit] = useState<Record<string, Unit>>({})
  const [saveState, setSaveState] = useState<Record<string, SaveState | undefined>>({})
  // The value currently being sent per product — blur and the «حفظ» tap both
  // fire on iPhone, and the second must not send the same thing again.
  const inFlight = useRef<Record<string, string>>({})
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category ?? UNCATEGORIZED))).sort((a, b) => a.localeCompare(b, "ar")),
    [items],
  )
  const doneCount = items.filter((i) => i.actualQty !== null).length

  const visible = useMemo(() => {
    const q = query.trim()
    const rows = items
      .filter((i) => category === "all" || (i.category ?? UNCATEGORIZED) === category)
      .filter((i) => (countFilter === "todo" ? i.actualQty === null : countFilter === "done" ? i.actualQty !== null : true))
    if (!q) return rows
    return rows
      .map((i) => ({
        i,
        score: scoreProduct(
          { name: i.productName, itemNumber: i.itemNumber ?? "", qrCode: i.qrCode, cartonQrCode: i.cartonQrCode, category: i.category },
          q,
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.i)
  }, [items, query, category, countFilter])

  async function save(item: PublicItem, opts: { focusNext?: boolean } = {}) {
    const raw = (localQty[item.productId] ?? "").trim()
    if (raw === "") return
    const qty = Number(raw)
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      setSaveState((s) => ({ ...s, [item.productId]: { status: "error", message: "اكتب رقم صحيح بدون كسور" } }))
      return
    }
    const unit = localUnit[item.productId] ?? "CARTON"
    const key = `${qty}|${unit}`
    if (inFlight.current[item.productId] === key) return
    inFlight.current[item.productId] = key
    setSaveState((s) => ({ ...s, [item.productId]: { status: "saving" } }))
    if (opts.focusNext) focusNextAfter(item.productId)
    try {
      await apiSetQty(token, item.productId, qty, unit, item.pcsPerCarton)
      // Clear only if the worker hasn't typed something newer meanwhile.
      setLocalQty((p) => ((p[item.productId] ?? "").trim() === raw ? { ...p, [item.productId]: "" } : p))
      setSaveState((s) => ({ ...s, [item.productId]: undefined }))
      onSaved()
    } catch (err) {
      setSaveState((s) => ({
        ...s,
        [item.productId]: { status: "error", message: workerError(err, "ما انحفظ — اضغط حفظ مرة ثانية") },
      }))
    } finally {
      delete inFlight.current[item.productId]
    }
  }

  /** «التالي» on the keypad jumps to the next product still waiting to be counted. */
  function focusNextAfter(productId: string) {
    const idx = visible.findIndex((i) => i.productId === productId)
    const next = visible.slice(idx + 1).find((i) => i.actualQty === null) ?? visible[idx + 1]
    const el = next ? inputRefs.current[next.productId] : null
    if (el) {
      el.focus()
      el.scrollIntoView({ block: "center", behavior: "smooth" })
    }
  }

  function step(item: PublicItem, delta: number) {
    setLocalQty((p) => {
      const cur = (p[item.productId] ?? "").trim()
      const unit = localUnit[item.productId] ?? "CARTON"
      // Start from the saved count (in the selected unit) when nothing is typed.
      const base = cur !== ""
        ? Number(cur) || 0
        : item.actualQty !== null
          ? unit === "CARTON" ? Math.floor(item.actualQty / Math.max(1, item.pcsPerCarton)) : item.actualQty
          : 0
      return { ...p, [item.productId]: String(Math.max(0, base + delta)) }
    })
  }

  const chip = (active: boolean) =>
    cn(
      "h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition",
      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600",
    )

  return (
    <div className="space-y-3">
      {/* Count filter + categories — one swipeable row each */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => setCountFilter("all")} className={chip(countFilter === "all")}>
          الكل ({items.length})
        </button>
        <button type="button" onClick={() => setCountFilter("todo")} className={chip(countFilter === "todo")}>
          لم يُحسب ({items.length - doneCount})
        </button>
        <button type="button" onClick={() => setCountFilter("done")} className={chip(countFilter === "done")}>
          تم ({doneCount})
        </button>
      </div>
      {categories.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" onClick={() => setCategory("all")} className={chip(category === "all")}>
            كل الفئات
          </button>
          {categories.map((c) => (
            <button key={c} type="button" onClick={() => setCategory(c)} className={chip(category === c)}>
              {c}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="py-10 text-center text-slate-400">
          {query.trim() ? `ما لكينا مادة تطابق «${query.trim()}»` : "لا توجد منتجات هنا."}
        </p>
      ) : (
        visible.map((item) => {
          const unit = localUnit[item.productId] ?? "CARTON"
          const saved = item.actualQty !== null
          const state = saveState[item.productId]
          const typed = localQty[item.productId] ?? ""
          const ppc = Math.max(1, item.pcsPerCarton)
          const showUnits = ppc > 1
          return (
            <div
              key={item.id}
              className={cn(
                "rounded-2xl border bg-white p-4 shadow-sm transition",
                state?.status === "error" ? "border-red-300" : saved ? "border-emerald-200" : "border-slate-200",
              )}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">{item.productName}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {item.itemNumber ? <span dir="ltr" className="font-mono">{item.itemNumber}</span> : null}
                    {item.itemNumber && item.category ? " · " : ""}
                    {item.category}
                  </p>
                </div>
                {saved && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                    ✓ {describeQty(item.actualQty ?? 0, item.pcsPerCarton)}
                  </span>
                )}
              </div>

              {showUnits && (
                <div className="mb-3 flex rounded-lg bg-slate-100 p-0.5">
                  {(["CARTON", "PIECE"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setLocalUnit((p) => ({ ...p, [item.productId]: u }))}
                      className={cn(
                        "h-10 flex-1 rounded-md text-sm font-semibold transition",
                        unit === u ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                      )}
                    >
                      {u === "CARTON" ? `كارتون (${ppc} قطعة)` : "قطعة"}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-stretch gap-2" dir="ltr">
                <button
                  type="button"
                  aria-label="إنقاص"
                  onClick={() => step(item, -1)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-200"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <input
                  ref={(el) => { inputRefs.current[item.productId] = el }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  enterKeyHint="next"
                  autoComplete="off"
                  aria-label={`عدد ${item.productName} ${showUnits && unit === "CARTON" ? "بالكارتون" : "بالقطعة"}`}
                  placeholder={saved
                    ? String(showUnits && unit === "CARTON" ? Math.floor((item.actualQty ?? 0) / ppc) : item.actualQty)
                    : "0"}
                  value={typed}
                  onChange={(e) => {
                    // Digits only — Arabic-Indic digits from an Arabic keypad included.
                    const v = e.target.value
                      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
                      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
                      .replace(/\D/g, "")
                    setLocalQty((p) => ({ ...p, [item.productId]: v }))
                    if (state?.status === "error") setSaveState((s) => ({ ...s, [item.productId]: undefined }))
                  }}
                  onBlur={() => void save(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void save(item, { focusNext: true })
                    }
                  }}
                  className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-lg font-semibold tabular-nums outline-none focus:border-emerald-400 focus:bg-white"
                />
                <button
                  type="button"
                  aria-label="زيادة"
                  onClick={() => step(item, 1)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 active:bg-slate-200"
                >
                  <Plus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => void save(item)}
                  disabled={!typed || state?.status === "saving"}
                  className="flex h-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 px-4 text-base font-bold text-white disabled:opacity-40"
                >
                  {state?.status === "saving" ? <Loader2 className="h-5 w-5 animate-spin" /> : "حفظ"}
                </button>
              </div>

              {state?.status === "error" && (
                <p role="alert" className="mt-2 text-sm font-medium text-red-600">{state.message}</p>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
