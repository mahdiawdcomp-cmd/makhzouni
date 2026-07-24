import { useState } from "react"
import type { StockCorrectionReason } from "../types/api"
import { Button } from "./ui/button"

// Arabic labels for the LossReason/StockCorrectionReason union — shared by
// AdjustStockModal, CycleCountPage and StocktakePage approval flows.
export const STOCK_CORRECTION_REASON_LABELS: Record<StockCorrectionReason, string> = {
  DAMAGE: "تلف",
  EXPIRY: "انتهاء صلاحية",
  THEFT: "سرقة / فقدان",
  DEFECT: "عطل في المنتج",
  COUNT_ERROR: "خطأ بالعد الأولي",
  OTHER: "أخرى",
}

const ALL_REASONS = Object.keys(STOCK_CORRECTION_REASON_LABELS) as StockCorrectionReason[]

/* Compact reason-selection modal — used wherever a stock correction (adjust /
   cycle-count approve / stocktake approve) needs a LossReason before it hits
   the backend. Same visual pattern as AdjustStockModal. */
export function ReasonPromptModal({
  title,
  description,
  options,
  loading,
  onConfirm,
  onCancel,
}: {
  title: string
  description?: string
  options?: StockCorrectionReason[]
  loading?: boolean
  onConfirm: (reason: StockCorrectionReason) => void
  onCancel: () => void
}) {
  const list = options && options.length > 0 ? options : ALL_REASONS
  const [reason, setReason] = useState<StockCorrectionReason>(list[0])

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-extrabold text-slate-900 dark:text-slate-100">{title}</h3>
        {description && <p className="mb-3 text-xs text-slate-500">{description}</p>}
        <label className="mb-1 block text-xs font-bold text-slate-600">السبب</label>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as StockCorrectionReason)}
          className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
        >
          {list.map((k) => (
            <option key={k} value={k}>{STOCK_CORRECTION_REASON_LABELS[k]}</option>
          ))}
        </select>
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" disabled={loading} onClick={() => onConfirm(reason)}>
            {loading ? "جاري الحفظ..." : "تأكيد"}
          </Button>
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        </div>
      </div>
    </div>
  )
}
