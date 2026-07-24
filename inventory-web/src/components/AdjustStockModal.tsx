import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { adjustProductStock } from "../api/endpoints"
import type { Product, StockCorrectionReason } from "../types/api"
import { STOCK_CORRECTION_REASON_LABELS } from "./ReasonPromptModal"
import { Button } from "./ui/button"
import { Input } from "./ui/input"

const REASON_OPTIONS = Object.keys(STOCK_CORRECTION_REASON_LABELS) as StockCorrectionReason[]

/* Manual per-warehouse stock adjustment — ZERO allowed. Records an audit entry
   server-side (who / when / from→to / reason) without touching invoices/profit. */
export function AdjustStockModal({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved?: () => void }) {
  const stocks = product.warehouseStocks ?? []
  const [rows, setRows] = useState(
    stocks.map((ws) => ({ warehouseId: ws.warehouseId, name: ws.warehouse?.name ?? "مخزن", current: ws.quantityPieces, value: String(ws.quantityPieces) })),
  )
  const [note, setNote] = useState("")
  const [reason, setReason] = useState<StockCorrectionReason | "">("")
  const qc = useQueryClient()

  const mut = useMutation({
    mutationFn: () => adjustProductStock(product.id, {
      warehouses: rows.map((r) => ({ warehouseId: r.warehouseId, quantityPieces: Math.max(0, Math.trunc(Number(r.value) || 0)) })),
      note: note.trim() || undefined,
      reason: reason as StockCorrectionReason,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["manual-adjustments", product.id] })
      qc.invalidateQueries({ queryKey: ["products"] })
      qc.invalidateQueries({ queryKey: ["product", product.id] })
      onSaved?.()
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 font-extrabold text-slate-900 dark:text-slate-100">تعديل الكمية يدوياً</h3>
        <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{product.name}</p>
        <p className="mb-4 text-xs text-slate-500">
          غيّر الكمية الفعلية بالمخزن (يُسمح بالصفر). يُسجّل بسجل خاص ولا يؤثر على الفواتير أو الأرباح.
        </p>
        {rows.length === 0 && <p className="text-sm text-amber-600">لا توجد مخازن مرتبطة بهذه المادة.</p>}
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.warehouseId} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{r.name}</div>
                <div className="text-[11px] text-slate-400">الحالي: {r.current} قطعة</div>
              </div>
              <Input
                type="number" min={0} className="w-28"
                value={r.value}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-bold text-slate-600">سبب التعديل <span className="text-red-500">*</span></label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as StockCorrectionReason)}
            className="w-full h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">اختر السبب</option>
            {REASON_OPTIONS.map((k) => (
              <option key={k} value={k}>{STOCK_CORRECTION_REASON_LABELS[k]}</option>
            ))}
          </select>
          {!reason && <p className="mt-1 text-[11px] text-amber-600">مطلوب اختيار السبب للحفظ</p>}
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-bold text-slate-600">ملاحظة (اختياري)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: جرد / تالف / تصحيح" />
        </div>
        {mut.isError && <p className="mt-2 text-xs text-red-600">تعذر حفظ التعديل.</p>}
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" disabled={mut.isPending || rows.length === 0 || !reason} onClick={() => mut.mutate()}>
            {mut.isPending ? "جار الحفظ..." : "حفظ التعديل"}
          </Button>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
        </div>
      </div>
    </div>
  )
}
