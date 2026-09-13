import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Check, PackageCheck, RefreshCw } from "lucide-react"
import { createTransfer, getProductsWithNegativeStock } from "../api/endpoints"
import type { NegativeStockProduct, NegativeStockSuggestion } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { toast } from "../components/ui/use-toast"

const fmt = (value: unknown) => Number(value ?? 0).toLocaleString("en-US")

/** Pieces read as cartons + loose pieces — the way the merchant counts them. */
function inCartons(pieces: number, pcsPerCarton: number) {
  const sign = pieces < 0 ? "-" : ""
  const abs = Math.abs(pieces)
  if (pcsPerCarton <= 1) return `${sign}${fmt(abs)} قطعة`
  const cartons = Math.floor(abs / pcsPerCarton)
  const rest = abs % pcsPerCarton
  if (cartons === 0) return `${sign}${fmt(rest)} قطعة`
  return `${sign}${fmt(cartons)} كارتون${rest ? ` و${fmt(rest)} قطعة` : ""}`
}

export function NegativeStockPage() {
  const qc = useQueryClient()
  const [done, setDone] = useState<Set<string>>(new Set())

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["products", "negative-stock"],
    queryFn: getProductsWithNegativeStock,
    staleTime: 30_000,
  })

  // A fixed product disappears on the next refetch; drop it locally so the row
  // gives immediate feedback without yanking the whole list around.
  const rows = (data?.data ?? []).filter((p) => !done.has(p.id))

  const transfer = useMutation({
    mutationFn: (vars: { product: NegativeStockProduct; fix: NegativeStockSuggestion }) =>
      createTransfer({
        fromBranchId: vars.fix.fromWarehouseId!,
        toBranchId: vars.fix.toWarehouseId,
        notes: `تعديل رصيد سالب — ${vars.product.name}`,
        items: [{ productId: vars.product.id, quantity: vars.fix.transferablePieces, unit: "PIECE" }],
      }),
    onSuccess: (_res, vars) => {
      toast({ title: `تم تحويل ${fmt(vars.fix.transferablePieces)} قطعة إلى ${vars.fix.toWarehouseName}` })
      setDone((prev) => new Set(prev).add(vars.product.id))
      void qc.invalidateQueries({ queryKey: ["products"], refetchType: "none" })
      void qc.invalidateQueries({ queryKey: ["transfers"], refetchType: "none" })
    },
    onError: (e: any) =>
      toast({ title: e?.response?.data?.message ?? "تعذّر تنفيذ التحويل", variant: "destructive" }),
  })

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ArrowLeftRight className="h-6 w-6" /> تعديل المخزون
          </h1>
          <p className="text-sm text-slate-500">
            مواد رصيدها سالب بمخزن وموجودة بمخزن ثاني — يعني انباعت ونُسي تحويلها. حوّل الناقص بضغطة ويتصفّر الرصيد.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => { setDone(new Set()); void refetch() }} disabled={isFetching}>
            <RefreshCw className={"h-4 w-4 " + (isFetching ? "animate-spin" : "")} /> تحديث
          </Button>
          <Button variant="outline" asChild>
            <Link to="/inventory"><ArrowLeft className="h-4 w-4" /> المخزن</Link>
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border bg-white p-10 text-center text-sm text-rose-600 dark:bg-slate-950">تعذّر تحميل القائمة.</p>
      ) : isLoading ? (
        <p className="rounded-xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-slate-950">جاري الفحص...</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border bg-white p-10 text-center dark:bg-slate-950">
          <PackageCheck className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 font-semibold">ما في أي مادة رصيدها سالب.</p>
          <p className="mt-1 text-sm text-slate-400">كل الأرصدة بمكانها الصحيح.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/20">
            <span className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <b>{fmt(rows.length)}</b> مادة عندها رصيد سالب
            </span>
            {done.size > 0 && (
              <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                <Check className="h-4 w-4" /> عدّلت {fmt(done.size)} مادة
              </span>
            )}
          </div>

          <div className="space-y-3">
            {rows.map((product) => (
              <div key={product.id} className="rounded-xl border bg-white p-4 dark:bg-slate-950">
                <div className="flex items-start gap-3">
                  {product.thumbnailUrl
                    ? <img src={product.thumbnailUrl} alt="" className="h-14 w-14 rounded-lg object-cover ring-1 ring-slate-200" />
                    : <span className="grid h-14 w-14 place-items-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-400">{product.itemNumber?.slice(0, 4)}</span>}
                  <div className="min-w-0 flex-1">
                    <Link to={`/inventory/${product.id}`} className="font-bold hover:underline">{product.name}</Link>
                    <p className="font-mono text-xs text-slate-400">{product.itemNumber}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    المجموع: <b className={product.totalPieces < 0 ? "text-rose-600" : "text-slate-900 dark:text-white"}>
                      {inCartons(product.totalPieces, product.pcsPerCarton)}
                    </b>
                  </span>
                </div>

                {/* Where the stock actually sits */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {product.warehouses.map((w) => (
                    <span
                      key={w.warehouseId}
                      className={
                        "rounded-lg px-3 py-1.5 text-xs font-semibold " +
                        (w.quantityPieces < 0
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                          : w.quantityPieces > 0
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-800")
                      }
                    >
                      {w.warehouseName}: {inCartons(w.quantityPieces, product.pcsPerCarton)}
                    </span>
                  ))}
                </div>

                {/* One suggested transfer per negative warehouse */}
                <div className="mt-3 space-y-2">
                  {product.suggestions.map((fix) => (
                    <div key={fix.toWarehouseId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
                      {fix.fromWarehouseId ? (
                        <>
                          <span className="text-sm">
                            حوّل <b>{inCartons(fix.transferablePieces, product.pcsPerCarton)}</b> من <b>{fix.fromWarehouseName}</b> إلى <b>{fix.toWarehouseName}</b>
                            {fix.transferablePieces < fix.neededPieces && (
                              <span className="text-amber-600"> — يغطي جزءاً فقط، الناقص {inCartons(fix.neededPieces - fix.transferablePieces, product.pcsPerCarton)}</span>
                            )}
                          </span>
                          <Button
                            size="sm"
                            onClick={() => transfer.mutate({ product, fix })}
                            disabled={transfer.isPending}
                          >
                            <ArrowLeftRight className="h-4 w-4" /> حوّل
                          </Button>
                        </>
                      ) : (
                        <span className="text-sm text-rose-600">
                          ناقص {inCartons(fix.neededPieces, product.pcsPerCarton)} بـ{fix.toWarehouseName}، وما في مخزن ثاني عنده رصيد — هذي تحتاج جرد فعلي.
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {(data?.unfixableCount ?? 0) > 0 && (
            <p className="rounded-xl border bg-white px-4 py-3 text-sm text-slate-500 dark:bg-slate-950">
              <b>{fmt(data?.unfixableCount)}</b> مادة مجموعها سالب بكل المخازن — التحويل ما يصلّحها، لازم تعدّ كميتها الحقيقية وتعدّلها من صفحة المادة.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default NegativeStockPage
