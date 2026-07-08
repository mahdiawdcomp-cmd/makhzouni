// Worker counting page for "جدولة الجرد الذكي" — independent from
// PublicStocktakePage.tsx (copies its UI approach: scan/manual modes, no
// login). Differences from the old page, per spec: systemQty is never sent by
// the backend at all (never just hidden client-side), and there is no
// worker-triggered "close" — only admin closes/cancels from the admin page.
import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { CheckCircle2, Package, ScanLine, ClipboardList } from "lucide-react"
import { api } from "../api/client"
import { cn } from "../utils/cn"

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

  const saveMut = useMutation({
    mutationFn: (p: { productId: string; qty: number; unit: "CARTON" | "PIECE" }) =>
      apiSetQty(token, p.productId, p.qty, p.unit),
    onSuccess: () => onUpdate(),
  })

  function save(item: PublicItem) {
    const val = localQty[item.productId]
    if (val === undefined || val === "") return
    const qty = Number(val)
    if (isNaN(qty) || qty < 0) return
    const unit = localUnit[item.productId] ?? "CARTON"
    saveMut.mutate({ productId: item.productId, qty, unit })
  }

  if (items.length === 0)
    return <p className="text-center text-slate-400 py-8">لا توجد منتجات مطابقة.</p>

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const unit = localUnit[item.productId] ?? "CARTON"
        const saved = item.actualQty !== null
        const locked = item.approvalStatus !== "PENDING"
        return (
          <div
            key={item.id}
            className={cn(
              "rounded-2xl bg-white p-4 shadow-sm border transition",
              saved ? "border-emerald-200" : "border-slate-200",
            )}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold">{productLabel(item)}</p>
                {item.category && <p className="text-xs text-slate-400">{item.category}</p>}
              </div>
              {saved && (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-700 whitespace-nowrap">
                  ✓ {item.actualQty} قطعة
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
                    type="number"
                    inputMode="numeric"
                    min={0}
                    placeholder="0"
                    value={localQty[item.productId] ?? ""}
                    onChange={(e) => setLocalQty((p) => ({ ...p, [item.productId]: e.target.value }))}
                    onBlur={() => save(item)}
                    onKeyDown={(e) => e.key === "Enter" && save(item)}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:bg-white"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => save(item)}
                    disabled={!localQty[item.productId]}
                    className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                  >
                    حفظ
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
