import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Loader2, PackageSearch, RotateCcw, Trash2 } from "lucide-react"
import { usePageTitle } from "../hooks/usePageTitle"
import {
  deleteRequestedProduct,
  getRequestedProducts,
  markRequestedProductHandled,
  reopenRequestedProduct,
  type RequestedProduct,
} from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"

// «المنتجات المطلوبة» — what customers asked the WhatsApp agent for and the
// shop does not carry. Ordered by how many people asked, because that is the
// whole point: demand, not a ticket queue.

function formatBaghdad(iso?: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" })
}

export function RequestedProductsPage() {
  usePageTitle("المنتجات المطلوبة")
  const qc = useQueryClient()
  const [tab, setTab] = useState<"OPEN" | "HANDLED">("OPEN")
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["requested-products", tab],
    queryFn: () => getRequestedProducts(tab),
    refetchInterval: 60000,
  })

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["requested-products"] })
    void qc.invalidateQueries({ queryKey: ["requested-products-open-count"] })
  }

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id)
    try {
      await action()
      invalidate()
    } catch (error) {
      toast({ title: apiErrorMessage(error), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <PackageSearch className="h-6 w-6 text-amber-600" /> المنتجات المطلوبة
        </h1>
        <p className="text-xs text-slate-500">منتجات طلبها زبائن بالواتساب وما موجودة عدك بالمحل</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        {([["OPEN", "المطلوبة حالياً"], ["HANDLED", "تمت معالجتها"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn("rounded-t-lg px-3 py-2 text-sm", tab === id ? "border-b-2 border-amber-600 font-semibold text-amber-700" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-slate-500">
          {tab === "OPEN" ? "ماكو طلبات حالياً — أي منتج يطلبه زبون وما يلكيه راح يظهر هنا" : "ماكو طلبات معالجة"}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row: RequestedProduct) => (
            <Card key={row.id}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
                <span className={cn(
                  "flex h-10 min-w-10 items-center justify-center rounded-full px-2 text-sm font-bold",
                  row.requestCount > 1 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                )}>
                  {row.requestCount}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.productName}</p>
                  <p className="text-xs text-slate-500">
                    آخر طلب: {formatBaghdad(row.updatedAt)} · من: {row.lastPhone}
                  </p>
                  {row.lastNote && <p className="truncate text-xs text-slate-400">ملاحظة: {row.lastNote}</p>}
                </div>
                {tab === "OPEN" ? (
                  <Button size="sm" variant="outline" disabled={busyId === row.id}
                    onClick={() => void run(row.id, () => markRequestedProductHandled(row.id))}>
                    {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="ml-1 h-3.5 w-3.5" /> تمت معالجته</>}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busyId === row.id}
                    onClick={() => void run(row.id, () => reopenRequestedProduct(row.id))}>
                    {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RotateCcw className="ml-1 h-3.5 w-3.5" /> إرجاعه للقائمة</>}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="text-red-600" disabled={busyId === row.id}
                  onClick={() => {
                    if (!window.confirm(`حذف طلب «${row.productName}» نهائياً؟`)) return
                    void run(row.id, () => deleteRequestedProduct(row.id))
                  }}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
