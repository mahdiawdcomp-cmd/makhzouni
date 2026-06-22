import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Package,
  Phone,
  FileText,
  Trash2,
} from "lucide-react"
import { getOrderPreparations, cancelInvoice } from "../../api/endpoints"
import type { OrderPreparation } from "../../types/api"
import { cn } from "../../utils/cn"

function unitAr(unit: string) {
  if (unit === "CARTON") return "كرتونة"
  if (unit === "DOZEN") return "درزن"
  return "قطعة"
}

function money(v: number | undefined) {
  return (v ?? 0).toLocaleString("en-US")
}

function OrderCard({ order }: { order: OrderPreparation }) {
  const [expanded, setExpanded] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const handleCreateInvoice = () => {
    // Pass order data via navigation state
    navigate("/invoices/create", {
      state: {
        fromOrderPreparationId: order.id,
        prefilledCustomerId: order.customerId,
        prefilledItems: order.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unit: item.unit as "PIECE" | "DOZEN" | "CARTON",
          unitPrice: item.unitPrice,
        })),
        prefilledTotal: order.totalAmount,
      }
    })
  }

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!order.invoiceId) throw new Error("لا يوجد فاتورة للإلغاء")
      return cancelInvoice(order.invoiceId)
    },
    onSuccess: () => {
      setShowCancelDialog(false)
      qc.invalidateQueries({ queryKey: ["order-preparations"] })
    },
  })


  return (
    <>
      {/* Cancel confirmation dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" dir="rtl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">إلغاء الطلب؟</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              هل أنت متأكد من إلغاء الفاتورة <strong>{order.invoiceNumber}</strong> للزبون <strong>{order.customerName}</strong>؟
            </p>
            <p className="mb-6 text-xs text-red-600 font-semibold">
              ⚠️ هذا الإجراء قد لا يكون قابلاً للتراجع عنه
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowCancelDialog(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
              >
                لا، احتفظ به
              </button>
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                className={cn(
                  "flex-1 rounded-lg py-2.5 text-sm font-bold text-white transition",
                  cancelMutation.isPending
                    ? "bg-red-400 cursor-wait"
                    : "bg-red-600 hover:bg-red-700 active:scale-95"
                )}
              >
                {cancelMutation.isPending ? "جاري الإلغاء..." : "نعم، ألغِ الفاتورة"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border-2 border-amber-300 bg-white shadow-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 truncate">{order.customerName}</p>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Phone className="h-3 w-3" />
              <span dir="ltr">{order.customerPhone}</span>
              <span className="text-slate-300">•</span>
              <span>فاتورة {order.invoiceNumber}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-600 hover:bg-white"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            {order.items.length} صنف
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          <button
            type="button"
            disabled={cancelMutation.isPending}
            onClick={() => setShowCancelDialog(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 transition-all"
            title="إلغاء الطلب"
          >
            <Trash2 className="h-4 w-4" />
            إلغاء
          </button>

          <button
            type="button"
            onClick={handleCreateInvoice}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all"
            title="فتح فاتورة جديدة معها البيانات مملوءة"
          >
            <FileText className="h-4 w-4" />
            إنشاء فاتورة
          </button>
        </div>
      </div>

      {/* Items list */}
      {expanded && (
        <div className="divide-y border-t bg-white">
          {order.items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-500">
                  {idx + 1}
                </span>
                <span className="font-medium">{item.productName}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-500">
                <span className="font-bold text-slate-700">{item.quantity} {unitAr(item.unit)}</span>
                {item.unitPrice !== undefined && (
                  <span className="text-xs">{money(item.unitPrice)} × {item.quantity} = <strong>{money(item.totalPrice)}</strong></span>
                )}
              </div>
            </div>
          ))}
          <div className="flex justify-between items-center px-4 py-2.5 bg-slate-50 text-sm font-semibold">
            <span>المجموع</span>
            <span>{money(order.totalAmount)} د.ع</span>
          </div>
        </div>
      )}
    </div>
    </>
  )
}

export function PendingOrdersBanner() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["order-preparations"],
    queryFn: getOrderPreparations,
    refetchInterval: 30_000,
  })

  if (isLoading || orders.length === 0) return null

  return (
    <div
      className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 shadow-lg"
      dir="rtl"
    >
      {/* Alert Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-extrabold text-amber-900">
            {orders.length === 1
              ? "يوجد طلب كاتلوك يحتاج للتجهيز"
              : `يوجد ${orders.length} طلبات كاتلوك تحتاج للتجهيز`}
          </h2>
          <p className="text-sm text-amber-700">
            يرجى تجهيز الطلبات التالية وضغط "تم التجهيز" — سيتلقى الزبون إشعار واتساب تلقائياً
          </p>
        </div>
        <div className="flex h-8 min-w-[2rem] items-center justify-center rounded-full bg-amber-500 px-2 text-sm font-bold text-white">
          {orders.length}
        </div>
      </div>

      {/* Order Cards */}
      <div className="space-y-3">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>
    </div>
  )
}
