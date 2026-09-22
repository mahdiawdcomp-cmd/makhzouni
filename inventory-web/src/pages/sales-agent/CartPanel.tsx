import { BadgePercent, Loader2, Minus, Plus, ShoppingCart, X } from "lucide-react"
import { Button } from "../../components/ui/button"
import type { AgentMode } from "../../utils/salesAgentDrafts"
import { UNIT_LABEL, money } from "./format"
import { type Unit, type AgentProduct, type CartLine, unitPrice } from "./model"

export function CartPanel({
  mode,
  locked,
  cart,
  productById,
  total,
  notes,
  onNotes,
  onChange,
  onSubmit,
  submitting,
  specialPrice,
}: {
  mode: AgentMode
  locked: boolean
  cart: CartLine[]
  productById: Map<string, AgentProduct>
  total: number
  notes: string
  onNotes: (v: string) => void
  onChange: (updater: (prev: CartLine[]) => CartLine[]) => void
  onSubmit: () => void
  submitting: boolean
  specialPrice: (productId: string, unit: Unit) => number | null
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <fieldset disabled={locked || submitting} className="min-h-0 flex-1 overflow-y-auto p-4">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ShoppingCart className="h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">السلة فارغة</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cart.map((line, idx) => {
              const product = productById.get(line.productId)
              if (!product) return <li key={line.productId} className="rounded-xl border border-red-300 p-3 text-sm text-red-700">مادة غير متاحة حالياً ({line.quantity} {UNIT_LABEL[line.unit]}) — السطر محفوظ للمراجعة.<Button variant="outline" className="mt-2 h-11" onClick={() => onChange(prev => prev.filter((_, i) => i !== idx))}>إزالة المادة غير المتاحة</Button></li>
              const special = specialPrice(line.productId, line.unit)
              const lineTotal = (special ?? unitPrice(product, line.unit, mode)) * line.quantity
              return (
                <li
                  key={`${line.productId}:${line.unit}`}
                  className="rounded-lg border p-3"
                  style={{ borderColor: "var(--theme-cardBorder)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13px] font-medium leading-snug">{product.name}</p>
                    <button
                      type="button"
                      aria-label="احذف السطر"
                      onClick={() => onChange((prev) => prev.filter((_, i) => i !== idx))}
                      className="-m-1.5 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {special != null && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <BadgePercent className="h-3 w-3" /> سعر خاص
                    </span>
                  )}

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        className="h-11 w-11 p-0"
                        aria-label="أنقص"
                        onClick={() =>
                          onChange((prev) =>
                            prev
                              .map((l, i) => (i === idx ? { ...l, quantity: l.quantity - 1 } : l))
                              .filter((l) => l.quantity > 0),
                          )
                        }
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="min-w-9 text-center text-[15px] font-bold tabular-nums">
                        {line.quantity}
                      </span>
                      <Button
                        variant="outline"
                        className="h-11 w-11 p-0"
                        aria-label="زد"
                        onClick={() =>
                          onChange((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, quantity: Math.min(100000, l.quantity + 1) } : l)),
                          )
                        }
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <span className="ms-1 text-[12px] text-slate-500">{UNIT_LABEL[line.unit]}</span>
                    </div>
                    <span className="text-[14px] font-bold tabular-nums">{money(lineTotal)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <textarea
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="ملاحظة على الطلب…"
          aria-label="ملاحظة على الطلب"
          rows={2}
          maxLength={4000}
          className="mt-3 w-full rounded border border-slate-300 bg-white p-3 text-[13.5px] placeholder:text-slate-400 focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
        />
      </fieldset>

      <div
        className="shrink-0 space-y-3 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={{ borderColor: "var(--theme-cardBorder)" }}
      >
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-slate-500">المجموع</span>
          <span className="text-xl font-bold tabular-nums">{money(total)}</span>
        </div>
        <Button className="h-11 w-full" disabled={cart.length === 0 || submitting} onClick={onSubmit}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? "جاري التحقق…" : locked ? "تحقق من إرسال الطلب" : "مراجعة الطلب واختيار الزبون"}
        </Button>
      </div>
    </div>
  )
}

/* ── customers ───────────────────────────────────────────────────────── */
