import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronLeft, Phone, ShoppingBag } from "lucide-react"
import { getRetailOrders, prepareRetailOrder } from "../../api/endpoints"
import type { RetailOrder } from "../../types/api"
import { cn } from "../../utils/cn"

function money(v: number | undefined) {
  return (v ?? 0).toLocaleString("en-US")
}

function RetailOrderCard({ order }: { order: RetailOrder }) {
  const [done, setDone] = useState(false)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => prepareRetailOrder(order.id),
    onSuccess: () => {
      setDone(true)
      setTimeout(() => qc.invalidateQueries({ queryKey: ["retail-orders"] }), 1200)
    },
  })

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 animate-pulse">
        <Check className="h-4 w-4" />
        <span className="font-semibold">تم تأكيد التجهيز — جاري إشعار {order.customerName}...</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-indigo-300 bg-white shadow-md overflow-hidden">
      <div className="flex items-center justify-between gap-3 bg-indigo-50 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 truncate">{order.customerName}</p>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Phone className="h-3 w-3" />
              <span dir="ltr">{order.phone}</span>
              <span className="text-slate-300">•</span>
              <span>{order.orderNumber}</span>
              <span className="text-slate-300">•</span>
              <span>{order.items.length} صنف</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-bold text-slate-700">{money(order.total)} د.ع</span>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white transition-all",
              mutation.isPending ? "bg-emerald-400 cursor-wait" : "bg-emerald-600 hover:bg-emerald-700 active:scale-95",
            )}
          >
            {mutation.isPending ? <>جاري...</> : <><Check className="h-4 w-4" /> تم التجهيز</>}
          </button>
        </div>
      </div>
      {order.address ? <div className="border-t bg-white px-4 py-2 text-xs text-slate-500">📍 {order.address}</div> : null}
    </div>
  )
}

export function RetailPendingBanner() {
  const navigate = useNavigate()
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["retail-orders", "PENDING"],
    queryFn: () => getRetailOrders("PENDING"),
    refetchInterval: 30_000,
  })

  if (isLoading || orders.length === 0) return null

  return (
    <div className="rounded-2xl border-2 border-indigo-400 bg-indigo-50 p-4 shadow-lg" dir="rtl">
      <button
        type="button"
        onClick={() => navigate("/retail-catalog?tab=orders")}
        className="mb-4 flex w-full items-center gap-3 text-right"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white shadow">
          <ShoppingBag className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="flex items-center gap-1 text-lg font-extrabold text-indigo-900">
            {orders.length === 1 ? "يوجد طلب مفرد يحتاج للتجهيز" : `يوجد ${orders.length} طلبات مفرد تحتاج للتجهيز`}
            <ChevronLeft className="h-5 w-5" />
          </h2>
          <p className="text-sm text-indigo-700">اضغط هنا لفتح صفحة طلبات المفرد، أو جهّز مباشرة من الأسفل</p>
        </div>
        <div className="flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-indigo-500 px-2 text-sm font-bold text-white">
          {orders.length}
        </div>
      </button>

      <div className="space-y-3">
        {orders.slice(0, 5).map((order) => (
          <RetailOrderCard key={order.id} order={order} />
        ))}
      </div>
    </div>
  )
}
