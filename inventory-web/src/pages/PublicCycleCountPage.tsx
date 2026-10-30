// Worker counting page for "جدولة الجرد الذكي" — independent from
// PublicStocktakePage.tsx (copies its UI approach: scan/manual modes, no
// login). Differences from the old page, per spec: systemQty is never sent by
// the backend at all (never just hidden client-side), and there is no
// worker-triggered "close" — only admin closes/cancels from the admin page.
import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { CheckCircle2, Package, ScanLine, ClipboardList, Loader2 } from "lucide-react"
import { api } from "../api/client"
import { cn } from "../utils/cn"
import { apiErrorMessage } from "../utils/apiError"

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublicItem {
  id: string
  productId: string
  productName: string
  itemNumber: string | null
  category: string | null
  qrCode: string | null
  cartonQrCode: string | null
  pcsPerCarton: number
  actualQty: number | null
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED"
}

// "AWD-225 | بويت باتري صوت وضوء" when itemNumber exists, else just the name.
function productLabel(item: Pick<PublicItem, "productName" | "itemNumber">) {
  return item.itemNumber ? `${item.itemNumber} | ${item.productName}` : item.productName
}

interface PublicSession {
  id: string
  status: string
  notes: string | null
  warehouse: { name: string } | null
  createdAt: string
  items: PublicItem[]
}

type Mode = "scan" | "manual"
type Unit = "CARTON" | "PIECE"

function describeQty(pieces: number, pcsPerCarton: number) {
  const ppc = Math.max(1, pcsPerCarton)
  if (ppc <= 1) return `${pieces} قطعة`
  const cartons = Math.floor(pieces / ppc)
  const loose = pieces % ppc
  const parts = [`${pieces} قطعة`]
  if (cartons > 0) parts.push(loose > 0 ? `${cartons} كارتون + ${loose}` : `${cartons} كارتون`)
  return parts.join(" · ")
}

/** True when no server answer came back (lost connection) — worth retrying. */
function isOfflineError(err: unknown) {
  return !(typeof err === "object" && err !== null && "response" in err && (err as { response?: unknown }).response)
}

function workerError(err: unknown, fallback: string) {
  return isOfflineError(err) ? `${fallback} (ماكو اتصال بالإنترنت)` : apiErrorMessage(err, fallback)
}

/** Arabic-Indic / Persian digits → ASCII, everything else stripped. */
function digitsOnly(v: string) {
  return v
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "")
}

// Saves that failed for lack of signal are parked here (per link) and retried
// automatically, so a weak warehouse connection never silently drops a count.
interface QueuedEntry { productId: string; qty: number; unit: Unit }
const queueKey = (token: string) => `cc-queue-${token}`
function readQueue(token: string): QueuedEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(queueKey(token)) ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function writeQueue(token: string, entries: QueuedEntry[]) {
  try {
    if (entries.length === 0) localStorage.removeItem(queueKey(token))
    else localStorage.setItem(queueKey(token), JSON.stringify(entries))
  } catch {
    /* storage blocked — nothing more we can do */
  }
}

type SaveState = { status: "saving" } | { status: "queued" } | { status: "error"; message: string }

// ── API calls ─────────────────────────────────────────────────────────────────

async function fetchSession(token: string): Promise<PublicSession> {
  const { data } = await api.get(`/cycle-count/public/${token}`)
  return (data as { data: PublicSession }).data
}

async function apiScan(token: string, qrCode: string) {
  const { data } = await api.post(`/cycle-count/public/${token}/scan`, { qrCode })
  return (data as { data: { productId: string; productName: string; itemNumber: string | null; newQty: number; category: string | null } }).data
}

async function apiSetQty(token: string, productId: string, qty: number, unit: "CARTON" | "PIECE") {
  const { data } = await api.put(`/cycle-count/public/${token}/item`, { productId, qty, unit })
  return data
}

async function apiSubmit(token: string) {
  const { data } = await api.post(`/cycle-count/public/${token}/submit`)
  return data
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function PublicCycleCountPage() {
  const { token } = useParams<{ token: string }>()
  const sessionQ = useQuery({
    queryKey: ["public-cycle-count", token],
    queryFn: () => fetchSession(token!),
    enabled: Boolean(token),
    staleTime: 30_000,
  })

  if (sessionQ.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50" dir="rtl">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Package className="h-10 w-10 animate-pulse" />
          <p className="text-sm">جاري التحميل...</p>
        </div>
      </div>
    )

  if (sessionQ.isError || !sessionQ.data)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="rounded-2xl bg-white p-8 shadow text-center max-w-sm">
          <p className="text-2xl mb-2">⚠️</p>
          <p className="font-bold text-lg">رابط غير صحيح</p>
          <p className="text-slate-500 text-sm mt-2">تأكد من الرابط وحاول مرة أخرى.</p>
        </div>
      </div>
    )

  const session = sessionQ.data
  if (session.status === "CLOSED" || session.status === "CANCELLED")
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="rounded-2xl bg-white p-8 shadow text-center max-w-sm">
          <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
          <p className="font-bold text-xl">
            {session.status === "CLOSED" ? "تم إغلاق الجرد" : "تم إلغاء الجرد"}
          </p>
          <p className="text-slate-500 text-sm mt-2">هذه الجلسة أُنهيت من قِبل الإدارة.</p>
        </div>
      </div>
    )

  if (session.status === "SUBMITTED")
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="rounded-2xl bg-white p-8 shadow text-center max-w-sm w-full">
          <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto mb-4" />
          <p className="font-bold text-2xl text-emerald-700">تم رفع الجرد!</p>
          <p className="text-slate-500 text-sm mt-2">سيراجع المسؤول النتائج. لا حاجة لإجراء إضافي منك الآن.</p>
        </div>
      </div>
    )

  return <WorkerInterface token={token!} session={session} onRefresh={() => sessionQ.refetch()} />
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
  const qc = useQueryClient()
  const [mode, setMode] = useState<Mode>("scan")
  const [submitted, setSubmitted] = useState(false)
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [category, setCategory] = useState<string>("all")
  const [search, setSearch] = useState("")

  const submitMut = useMutation({
    mutationFn: () => apiSubmit(token),
    onSuccess: () => setSubmitted(true),
  })

  const categories = ["all", ...Array.from(new Set(session.items.map((i) => i.category ?? "غير مصنّف"))).sort()]
  const categoryItems = session.items.filter(
    (i) => category === "all" || (i.category ?? "غير مصنّف") === category,
  )
  const visibleItems = search.trim()
    ? categoryItems.filter((i) => i.productName.toLowerCase().includes(search.trim().toLowerCase()))
    : categoryItems

  const filled = session.items.filter((i) => i.actualQty !== null).length

  if (submitted)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4" dir="rtl">
        <div className="rounded-2xl bg-white p-8 shadow text-center max-w-sm w-full">
          <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto mb-4" />
          <p className="font-bold text-2xl text-emerald-700">تم رفع الجرد!</p>
          <p className="text-slate-500 text-sm mt-2">سيراجع المسؤول النتائج. لا حاجة لإجراء إضافي منك الآن.</p>
        </div>
      </div>
    )

  return (
    <div className="min-h-screen bg-slate-50 pb-24" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b shadow-sm px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-lg">جرد ذكي</p>
              <p className="text-sm font-semibold text-slate-700">
                المخزن المطلوب جرده: {session.warehouse?.name ?? "الفرع الرئيسي"}
              </p>
              <p className="text-xs text-slate-500">{filled}/{session.items.length} منتج</p>
            </div>
            <div className={`rounded-full px-3 py-1 text-xs font-bold ${filled === session.items.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {filled}/{session.items.length}
            </div>
          </div>

          {/* Mode toggle */}
          <div className="mt-3 flex rounded-xl bg-slate-100 p-1 gap-1">
            <button
              type="button"
              onClick={() => setMode("scan")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition",
                mode === "scan" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
              )}
            >
              <ScanLine className="h-4 w-4" /> مسح باركود
            </button>
            <button
              type="button"
              onClick={() => setMode("manual")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition",
                mode === "manual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
              )}
            >
              <ClipboardList className="h-4 w-4" /> إدخال يدوي
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {mode === "scan" ? (
          <ScanMode
            token={token}
            items={session.items}
            msg={scanMsg}
            onScan={(msg) => { setScanMsg(msg); onRefresh() }}
          />
        ) : (
          <>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن منتج بالاسم أو الباركود..."
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-400"
            />

            {/* Category filter */}
            <div className="flex gap-2 flex-wrap">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium border transition",
                    category === c
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200",
                  )}
                >
                  {c === "all" ? "الكل" : c}
                </button>
              ))}
            </div>

            <ManualMode
              token={token}
              items={visibleItems}
              onUpdate={() => { qc.invalidateQueries({ queryKey: ["public-cycle-count", token] }); onRefresh() }}
            />
          </>
        )}
      </div>

      {/* Submit button */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-4 shadow-lg">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            disabled={submitMut.isPending || filled === 0}
            onClick={() => {
              if (confirm("هل أنت متأكد من رفع الجرد؟ لن تتمكن من التعديل بعدها إلا إذا أعاد المسؤول فتح الجلسة."))
                submitMut.mutate()
            }}
            className="w-full rounded-xl bg-emerald-600 py-3.5 text-sm font-bold text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitMut.isPending ? "جاري الرفع..." : `✅ رفع الجرد (${filled} منتج)`}
          </button>
          {filled < session.items.length && (
            <p className="text-center text-xs text-slate-400 mt-2">
              {session.items.length - filled} منتج لم يُحسب بعد — يمكنك الرفع والرجوع لاحقاً
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

  useEffect(() => { inputRef.current?.focus() }, [])

  const scanMut = useMutation({
    mutationFn: (qr: string) => apiScan(token, qr),
    onSuccess: (d) => {
      onScan({ text: `✓ ${productLabel(d)} — ${d.newQty} قطعة`, ok: true })
      setLocalInput("")
      setTimeout(() => inputRef.current?.focus(), 100)
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : "خطأ"
      onScan({ text: `✗ ${message}`, ok: false })
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
      <div className="rounded-2xl bg-white p-5 shadow-sm border">
        <p className="font-semibold mb-3">وجّه مسدس الباركود نحو المنتج</p>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={localInput}
            onChange={(e) => setLocalInput(e.target.value)}
            placeholder="امسح الباركود أو اكتبه يدوياً..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-400 focus:bg-white"
            dir="ltr"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
          />
          <button type="submit" className="mt-2 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white">
            {scanMut.isPending ? "..." : "تسجيل"}
          </button>
        </form>

        {msg && (
          <div className={cn(
            "mt-3 rounded-xl px-4 py-3 text-sm font-medium",
            msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
          )}>
            {msg.text}
          </div>
        )}
      </div>

      {scanned.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-sm border">
          <p className="font-semibold text-sm mb-3">المنتجات المُحسوبة ({scanned.length})</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {scanned.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2">
                <span className="text-sm font-medium">{productLabel(item)}</span>
                <span className="rounded-full bg-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                  {item.actualQty} قطعة
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

function ManualMode({
  token,
  items,
  onUpdate,
}: {
  token: string
  items: PublicItem[]
  onUpdate: () => void
}) {
  const [localQty, setLocalQty] = useState<Record<string, string>>({})
  const [localUnit, setLocalUnit] = useState<Record<string, "CARTON" | "PIECE">>({})
  // Default unit for the whole session. A shop count is almost all loose pieces,
  // a main-warehouse count is cartons — so the worker picks once here instead of
  // flipping every row. Remembered per link so a reload keeps the choice.
  const unitKey = `cc-default-unit-${token}`
  const [defaultUnit, setDefaultUnit] = useState<"CARTON" | "PIECE">(() => {
    try {
      return localStorage.getItem(unitKey) === "PIECE" ? "PIECE" : "CARTON"
    } catch {
      return "CARTON"
    }
  })
  function changeDefaultUnit(u: "CARTON" | "PIECE") {
    setDefaultUnit(u)
    try {
      localStorage.setItem(unitKey, u)
    } catch {
      /* private mode / storage blocked — the in-memory choice still applies */
    }
  }

  const [saveState, setSaveState] = useState<Record<string, SaveState | undefined>>({})
  const [queuedCount, setQueuedCount] = useState(() => readQueue(token).length)
  const inFlight = useRef<Set<string>>(new Set())
  // Products this worker saved on this visit — overwriting those needs no prompt.
  const editedThisSession = useRef<Set<string>>(new Set())
  const flushing = useRef(false)

  async function flushQueue() {
    if (flushing.current) return
    const entries = readQueue(token)
    if (entries.length === 0) return
    flushing.current = true
    let changed = false
    try {
      for (const e of entries) {
        try {
          await apiSetQty(token, e.productId, e.qty, e.unit)
        } catch (err) {
          if (isOfflineError(err)) break // still offline — try again later
          // A real rejection (item already reviewed…): show it, don't wedge the queue.
          setSaveState((st) => ({ ...st, [e.productId]: { status: "error", message: workerError(err, "ما انحفظ") } }))
          writeQueue(token, readQueue(token).filter((x) => x.productId !== e.productId))
          changed = true
          continue
        }
        writeQueue(token, readQueue(token).filter((x) => x.productId !== e.productId))
        setSaveState((st) => (st[e.productId]?.status === "queued" ? { ...st, [e.productId]: undefined } : st))
        changed = true
      }
    } finally {
      flushing.current = false
      setQueuedCount(readQueue(token).length)
      if (changed) onUpdate()
    }
  }

  useEffect(() => {
    void flushQueue()
    const onOnline = () => void flushQueue()
    window.addEventListener("online", onOnline)
    const id = window.setInterval(() => void flushQueue(), 15_000)
    return () => { window.removeEventListener("online", onOnline); window.clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function save(item: PublicItem) {
    const raw = (localQty[item.productId] ?? "").trim()
    if (raw === "") return
    const qty = Number(raw)
    if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
      setSaveState((st) => ({ ...st, [item.productId]: { status: "error", message: "اكتب رقم صحيح بدون كسور" } }))
      return
    }
    const unit = localUnit[item.productId] ?? defaultUnit
    // Enter then blur fire back-to-back — one save (and one prompt) is enough.
    if (inFlight.current.has(item.productId)) return
    inFlight.current.add(item.productId)
    try {
      // Another worker (or an earlier visit) already counted this product.
      if (item.actualQty !== null && !editedThisSession.current.has(item.productId)) {
        const already = describeQty(item.actualQty, item.pcsPerCarton)
        if (!confirm(`هذه المادة محسوبة مسبقاً (${already}).\nتكتب فوق العدّ السابق؟`)) return
      }
      setSaveState((st) => ({ ...st, [item.productId]: { status: "saving" } }))
      // Clear the box only if nothing newer was typed — a stale value left behind
      // would be re-saved in whatever unit the worker flips to next.
      const clearTyped = () =>
        setLocalQty((p) => ((p[item.productId] ?? "").trim() === raw ? { ...p, [item.productId]: "" } : p))
      try {
        await apiSetQty(token, item.productId, qty, unit)
        editedThisSession.current.add(item.productId)
        clearTyped()
        setSaveState((st) => ({ ...st, [item.productId]: undefined }))
        onUpdate()
      } catch (err) {
        if (isOfflineError(err)) {
          writeQueue(token, [...readQueue(token).filter((e) => e.productId !== item.productId), { productId: item.productId, qty, unit }])
          setQueuedCount(readQueue(token).length)
          editedThisSession.current.add(item.productId)
          clearTyped()
          setSaveState((st) => ({ ...st, [item.productId]: { status: "queued" } }))
        } else {
          setSaveState((st) => ({ ...st, [item.productId]: { status: "error", message: workerError(err, "ما انحفظ — اضغط حفظ مرة ثانية") } }))
        }
      }
    } finally {
      inFlight.current.delete(item.productId)
    }
  }

  if (items.length === 0)
    return <p className="text-center text-slate-400 py-8">لا توجد منتجات مطابقة.</p>

  return (
    <div className="space-y-3">
      {queuedCount > 0 && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {queuedCount} عدّ ينتظر الاتصال — راح ينحفظ تلقائياً من يرجع النت. لا تسكّر الصفحة.
        </p>
      )}
      <div className="rounded-2xl bg-white p-3 shadow-sm border border-slate-200">
        <p className="mb-2 text-xs font-semibold text-slate-600">الوحدة الافتراضية للعدّ</p>
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {(["CARTON", "PIECE"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => changeDefaultUnit(u)}
              className={cn(
                "flex-1 rounded-md py-1.5 text-xs font-semibold transition",
                defaultUnit === u ? "bg-white shadow-sm text-slate-900" : "text-slate-500",
              )}
            >
              {u === "CARTON" ? "كارتون" : "قطعة"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          تنطبق على كل المواد — وتكدر تغيّرها لأي مادة لحالها.
        </p>
      </div>
      {items.map((item) => {
        const unit = localUnit[item.productId] ?? defaultUnit
        const saved = item.actualQty !== null
        const locked = item.approvalStatus !== "PENDING"
        const state = saveState[item.productId]
        return (
          <div
            key={item.id}
            className={cn(
              "rounded-2xl bg-white p-4 shadow-sm border transition",
              state?.status === "error" ? "border-red-300" : state?.status === "queued" ? "border-amber-300" : saved ? "border-emerald-200" : "border-slate-200",
            )}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold">{productLabel(item)}</p>
                {item.category && <p className="text-xs text-slate-400">{item.category}</p>}
              </div>
              {saved && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 whitespace-nowrap">
                  ✓ {describeQty(item.actualQty ?? 0, item.pcsPerCarton)}
                </span>
              )}
            </div>

            {locked ? (
              <p className="text-xs text-slate-400">تمت مراجعة هذا الصنف من الإدارة.</p>
            ) : (
              <>
                <div className="flex rounded-lg bg-slate-100 p-0.5 mb-3">
                  {(["CARTON", "PIECE"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setLocalUnit((p) => ({ ...p, [item.productId]: u }))}
                      className={cn(
                        "flex-1 rounded-md py-1.5 text-xs font-semibold transition",
                        unit === u ? "bg-white shadow-sm text-slate-900" : "text-slate-500",
                      )}
                    >
                      {u === "CARTON" ? `كارتون (${item.pcsPerCarton} قطعة)` : "قطعة"}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    placeholder="0"
                    value={localQty[item.productId] ?? ""}
                    onChange={(e) => {
                      const v = digitsOnly(e.target.value)
                      setLocalQty((p) => ({ ...p, [item.productId]: v }))
                      if (state?.status === "error") setSaveState((st) => ({ ...st, [item.productId]: undefined }))
                    }}
                    onBlur={() => void save(item)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void save(item)
                      }
                    }}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:bg-white"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => void save(item)}
                    disabled={!localQty[item.productId] || state?.status === "saving"}
                    className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                  >
                    {state?.status === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}
                  </button>
                </div>
                {state?.status === "error" && (
                  <p role="alert" className="mt-2 text-sm font-medium text-red-600">{state.message}</p>
                )}
                {state?.status === "queued" && (
                  <p className="mt-2 text-sm font-medium text-amber-700">محفوظ على الجهاز — ينرسل من يرجع النت</p>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
