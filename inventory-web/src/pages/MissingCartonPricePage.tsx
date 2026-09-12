import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ArrowLeft, Boxes, Check, PackageCheck, RefreshCw, SkipForward } from "lucide-react"
import { getProductsMissingCartonPrice, setCartonPiecePrice } from "../api/endpoints"
import type { MissingCartonPriceProduct } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { toast } from "../components/ui/use-toast"

const fmt = (value: unknown) => Number(value ?? 0).toLocaleString("en-US")

/** Dinars aren't priced to the unit — snap suggestions DOWN so they can never exceed wholesale. */
function roundDown(value: number, step = 250) {
  const snapped = Math.floor(value / step) * step
  return snapped > 0 ? snapped : Math.max(1, Math.round(value))
}

const DISCOUNTS = [0, 5, 10, 15, 20]

export function MissingCartonPricePage() {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["products", "missing-carton-price"],
    queryFn: getProductsMissingCartonPrice,
    staleTime: 60_000,
  })

  // Saved products stop qualifying, but refetching mid-flow would yank the list
  // out from under the cursor. Drop them locally instead and refetch on demand.
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [cursor, setCursor] = useState(0)
  const [piecePrice, setPiecePrice] = useState("")
  const [cartonPrice, setCartonPrice] = useState("")

  const queue = useMemo(
    () => (data?.data ?? []).filter((p) => !doneIds.has(p.id)),
    [data, doneIds]
  )
  const current: MissingCartonPriceProduct | undefined = queue[Math.min(cursor, queue.length - 1)]
  const savedCount = doneIds.size

  // A saved product leaves the queue at `cursor`, so the cursor already points at
  // the next one; this only guards the tail (skipping to the end, or a refetch).
  useEffect(() => {
    if (queue.length > 0 && cursor > queue.length - 1) setCursor(queue.length - 1)
  }, [queue.length, cursor])

  // Fresh, empty inputs for every product — never carry a price across items.
  useEffect(() => {
    setPiecePrice("")
    setCartonPrice("")
    inputRef.current?.focus()
  }, [current?.id])

  const pcs = current?.pcsPerCarton ?? 1
  const wholesale = Number(current?.salePrice ?? 0)
  const piece = Number(piecePrice)
  const valid = Number.isFinite(piece) && piece > 0 && piece <= wholesale
  const savingPct = valid && wholesale > 0 ? Math.round(((wholesale - piece) / wholesale) * 100) : 0

  function applyPiece(value: string) {
    setPiecePrice(value)
    const n = Number(value)
    setCartonPrice(Number.isFinite(n) && value !== "" ? String(Math.round(n * pcs)) : "")
  }

  function applyCarton(value: string) {
    setCartonPrice(value)
    const n = Number(value)
    // The stored field is a PIECE price; the carton box is just a friendlier way in.
    setPiecePrice(Number.isFinite(n) && value !== "" && pcs > 0 ? String(Math.round(n / pcs)) : "")
  }

  const saveMut = useMutation({
    mutationFn: (vars: { id: string; price: number }) => setCartonPiecePrice(vars.id, vars.price),
    onSuccess: (_res, vars) => {
      setDoneIds((prev) => new Set(prev).add(vars.id))
      // The products list now holds a stale price — mark it, don't refetch it here.
      void qc.invalidateQueries({ queryKey: ["products"], refetchType: "none" })
    },
    onError: (e: any) =>
      toast({
        title: e?.response?.data?.message ?? "تعذّر حفظ سعر الكارتون",
        variant: "destructive",
      }),
  })

  function save() {
    if (!current || !valid || saveMut.isPending) return
    saveMut.mutate({ id: current.id, price: piece })
  }

  function skip() {
    setCursor((c) => Math.min(c + 1, queue.length - 1))
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border bg-white p-10 text-center dark:bg-slate-950">
        <p className="text-sm text-rose-600">تعذّر تحميل القائمة.</p>
        <Button variant="outline" className="mt-3" onClick={() => void refetch()}>
          <RefreshCw className="h-4 w-4" /> إعادة المحاولة
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Boxes className="h-6 w-6" /> البضاعة بدون سعر كارتون
          </h1>
          <p className="text-sm text-slate-500">
            مواد عندها كارتون كامل أو أكثر بالمخزن ولا يوجد لها سعر كارتون — ضع السعر وانتقل للمادة التي بعدها.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => { setDoneIds(new Set()); setCursor(0); void refetch() }} disabled={isFetching}>
            <RefreshCw className={"h-4 w-4 " + (isFetching ? "animate-spin" : "")} /> تحديث
          </Button>
          <Button variant="outline" asChild>
            <Link to="/inventory"><ArrowLeft className="h-4 w-4" /> المخزن</Link>
          </Button>
        </div>
      </div>

      {/* Progress */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/20">
        <span className="text-amber-800 dark:text-amber-300">
          {isLoading ? "جاري الفحص..." : <><b>{queue.length}</b> مادة بانتظار سعر الكارتون</>}
        </span>
        {savedCount > 0 && (
          <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
            <Check className="h-4 w-4" /> تم تسعير {savedCount} مادة بهذه الجلسة
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="rounded-xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-slate-950">جاري التحميل...</p>
      ) : !current ? (
        <div className="rounded-xl border bg-white p-10 text-center dark:bg-slate-950">
          <PackageCheck className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 font-semibold">كل البضاعة التي عندها كارتون كامل لها سعر كارتون.</p>
          <p className="mt-1 text-sm text-slate-400">لا يوجد شيء ناقص الآن.</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-950 md:p-6">
          {/* Current product */}
          <div className="flex items-start gap-3">
            {current.thumbnailUrl
              ? <img src={current.thumbnailUrl} alt="" className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
              : <span className="grid h-20 w-20 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-400">{current.itemNumber?.slice(0, 4)}</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold">{current.name}</p>
              <p className="font-mono text-xs text-slate-400">{current.itemNumber}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-slate-500">القطع بالكارتون: <b className="text-slate-900 dark:text-white">{fmt(pcs)}</b></span>
                <span className="text-slate-500">الكراتين المتوفرة: <b className="text-slate-900 dark:text-white">{fmt(current.fullCartons)}</b></span>
                <span className="text-slate-500">الكمية الكلية: <b className="text-slate-900 dark:text-white">{fmt(current.currentStock)}</b> قطعة</span>
                <span className="text-slate-500">سعر الجملة للقطعة: <b className="text-emerald-600">{fmt(wholesale)}</b></span>
                <span className="text-slate-500">سعر المفرد: <b className="text-slate-900 dark:text-white">{fmt(current.retailPrice)}</b></span>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {Math.min(cursor + 1, queue.length)} من {queue.length}
            </span>
          </div>

          {/* Quick suggestions off the wholesale price */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">اقتراح سريع:</span>
            {DISCOUNTS.map((pct) => {
              const suggestion = pct === 0 ? Math.round(wholesale) : roundDown(wholesale * (1 - pct / 100))
              return (
                <button
                  key={pct}
                  type="button"
                  onClick={() => applyPiece(String(suggestion))}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
                >
                  {pct === 0 ? "نفس الجملة" : `أرخص ${pct}٪`} · {fmt(suggestion)}
                </button>
              )
            })}
          </div>

          {/* Price entry — either box fills the other */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">سعر القطعة داخل الكارتون</span>
              <input
                ref={inputRef}
                type="number"
                inputMode="numeric"
                value={piecePrice}
                onChange={(e) => applyPiece(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save() } }}
                placeholder="0"
                className="h-12 w-full rounded-lg border px-3 text-lg font-bold outline-none focus:ring-2 focus:ring-slate-900 dark:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">سعر الكارتون الكامل ({fmt(pcs)} قطعة)</span>
              <input
                type="number"
                inputMode="numeric"
                value={cartonPrice}
                onChange={(e) => applyCarton(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save() } }}
                placeholder="0"
                className="h-12 w-full rounded-lg border px-3 text-lg font-bold outline-none focus:ring-2 focus:ring-slate-900 dark:bg-slate-900"
              />
            </label>
          </div>

          {/* Live feedback */}
          <p className="mt-2 min-h-[20px] text-xs">
            {piecePrice === "" ? (
              <span className="text-slate-400">سعر الكارتون لازم يكون أقل من سعر الجملة أو مساوياً له.</span>
            ) : !valid ? (
              <span className="font-semibold text-rose-600">
                {piece > wholesale
                  ? `لا يجوز أن يتجاوز سعر الجملة (${fmt(wholesale)}) — خفّض السعر أو عدّل سعر الجملة من صفحة المادة.`
                  : "أدخل سعراً أكبر من صفر."}
              </span>
            ) : (
              <span className="font-semibold text-emerald-600">
                أرخص من الجملة بـ {savingPct}٪ — الزبون يوفّر {fmt((wholesale - piece) * pcs)} على الكارتون الواحد.
              </span>
            )}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={save} disabled={!valid || saveMut.isPending} className="h-11 px-6 text-base">
              <Check className="h-4 w-4" /> {saveMut.isPending ? "جاري الحفظ..." : "حفظ وانتقل للتالي"}
            </Button>
            <Button variant="outline" onClick={skip} disabled={queue.length < 2} className="h-11">
              <SkipForward className="h-4 w-4" /> تخطي
            </Button>
            <Button variant="ghost" asChild className="h-11">
              <Link to={`/inventory/${current.id}`}>فتح صفحة المادة</Link>
            </Button>
          </div>
        </div>
      )}

      {/* The rest of the backlog — click to jump */}
      {queue.length > 1 && (
        <div className="overflow-hidden rounded-xl border bg-white dark:bg-slate-950">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-3 text-right">المادة</th>
                <th className="px-3 py-3 text-right">الكراتين</th>
                <th className="px-3 py-3 text-right">القطع بالكارتون</th>
                <th className="px-3 py-3 text-right">سعر الجملة</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {queue.map((p, i) => (
                <tr
                  key={p.id}
                  onClick={() => setCursor(i)}
                  className={
                    "cursor-pointer " +
                    (i === Math.min(cursor, queue.length - 1)
                      ? "bg-slate-900/5 dark:bg-white/5"
                      : "hover:bg-slate-50/60 dark:hover:bg-slate-900/40")
                  }
                >
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-slate-400">{p.itemNumber}</p>
                  </td>
                  <td className="px-3 py-2.5 font-semibold">{fmt(p.fullCartons)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{fmt(p.pcsPerCarton)}</td>
                  <td className="px-3 py-2.5 text-emerald-600">{fmt(p.salePrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default MissingCartonPricePage
