import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, BadgePercent, Minus, Package, Plus } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { QueryErrorBox } from "../../components/ui/query-error"
import { cn } from "../../utils/cn"
import { useAuthStore } from "../../store/authStore"
import { agentDefaultUnit } from "../../utils/salesAgentCatalog"
import type { AgentMode } from "../../utils/salesAgentDrafts"
import { UNIT_LABEL, money } from "./format"
import { type Unit, type AgentProduct, unitPrice, maxQty, availableUnits, type CatalogColumns, wholeUnits } from "./model"
import { Dialog, Loading } from "./ui"
import { useThumbnails } from "./hooks"

export function CatalogScreen({
  allProductIds,
  mode,
  products,
  loading,
  paused,
  error,
  onRetry,
  search,
  columns,
  onOpen,
  onQuickAdd,
  locked,
  inCart,
  specialPrice,
}: {
  allProductIds: string[]
  mode: AgentMode
  products: AgentProduct[]
  loading: boolean
  paused: boolean
  error: boolean
  onRetry: () => void
  search: string
  columns: CatalogColumns
  onOpen: (p: AgentProduct) => void
  onQuickAdd: (p: AgentProduct) => void
  /** A sent order awaits confirmation: nothing may be added until it settles. */
  locked: boolean
  inCart: Map<string, Array<{ unit: Unit; quantity: number }>>
  specialPrice: (productId: string, unit: Unit) => number | null
}) {
  const [visible, setVisible] = useState<string[]>([])
  const thumbs = useThumbnails(allProductIds, visible)
  const observer = useRef<IntersectionObserver | null>(null)

  /**
   * Built ON FIRST USE, not in an effect.
   *
   * Callback refs run BEFORE effects. Creating the observer in a `useEffect`
   * means it does not exist when the first screenful of cards attaches, so every
   * one of them is silently skipped and their thumbnails never load.
   */
  const getObserver = () => {
    if (!observer.current) {
      observer.current = new IntersectionObserver(
        (entries) => {
          const seen = entries
            .filter((e) => e.isIntersecting)
            .map((e) => (e.target as HTMLElement).dataset.pid)
            .filter(Boolean) as string[]
          if (seen.length === 0) return
          setVisible((prev) => {
            const next = seen.filter((id) => !prev.includes(id))
            return next.length > 0 ? [...prev, ...next] : prev
          })
        },
        { rootMargin: "300px" },
      )
    }
    return observer.current
  }

  useEffect(() => () => observer.current?.disconnect(), [])

  const observe = useCallback((node: HTMLElement | null) => {
    if (node) getObserver().observe(node)
  }, [])

  if (error && products.length === 0) return <QueryErrorBox title="ما وصلت المواد" onRetry={onRetry} />

  return (
    <section aria-label="كتلوك المندوب" className="space-y-3">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-sm font-semibold">{products.length} مادة متوفرة</p>
          <p className="text-xs text-slate-500">{search ? "نتائج البحث" : "اضغط الصورة للتفاصيل والإضافة"}</p>
        </div>

        {loading ? (
          paused ? (
            <QueryErrorBox title="ما في اتصال" onRetry={onRetry} />
          ) : (
            <Loading />
          )
        ) : products.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">ما اكو نتائج</p>
        ) : (
          <div className={cn("grid", columns === 4 ? "gap-1.5 sm:gap-3" : "gap-2.5 sm:gap-3")} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {products.map((product) => {
              const special = availableUnits(product).some((u) => specialPrice(product.id, u) !== null)
              const pieces = product.currentStock
              // «أقل من كارتون» is the owner's own line for "running out". Shown
              // in red, never enforced: a shortage does not block a sale here.
              const low = product.pcsPerCarton > 0 && pieces < product.pcsPerCarton
              // The reps count in pieces and dozens; cartons are rare. So the
              // wholesale line says both, and carton mode says cartons.
              const stockText =
                mode === "CARTON"
                  ? `متوفر ${Math.floor(pieces / Math.max(1, product.pcsPerCarton))} كارتون · ${product.pcsPerCarton} قطعة بالكارتون`
                  : pieces >= 12
                    ? `المتوفر ${pieces} قطعة · يكفي ${Math.floor(pieces / 12)} درزن`
                    : `المتوفر ${pieces} قطعة`
              const held = inCart.get(product.id)
              return (
                // A wrapper, not the card itself: the quick-add button cannot
                // live INSIDE the card's button — a button in a button is
                // invalid, and the browser hands the tap to the outer one.
                <div key={product.id} className="relative min-w-0">
                <button
                  type="button"
                  data-pid={product.id}
                  ref={observe}
                  onClick={() => onOpen(product)}
                  className="sales-agent-product group flex h-full w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-2xl border bg-[var(--theme-cardBg)] text-start shadow-sm transition-[transform,box-shadow,border-color] duration-200 active:scale-[0.98] hover:-translate-y-0.5 hover:border-[var(--theme-accent)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-accent)]"
                  style={{ borderColor: held ? "var(--theme-accent)" : "var(--theme-cardBorder)" }}
                >
                  <div className="relative aspect-square w-full bg-slate-100 dark:bg-slate-800">
                    {thumbs[product.id] ? (
                      <img
                        src={thumbs[product.id] as string}
                        alt={product.name}
                        loading="lazy"
                        decoding="async"
                      className="h-full w-full bg-white object-contain p-1 transition-transform duration-300 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-slate-400">
                        <Package className="h-7 w-7" />
                      </div>
                    )}
                    {special && (
                      <span className="absolute end-2 top-2 flex items-center gap-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                        <BadgePercent className="h-3 w-3" />
                        سعر خاص
                      </span>
                    )}
                    {(product.isNewArrival || product.isOffer) && <span className="absolute start-2 bottom-2 rounded-full bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white">{product.isNewArrival ? "جديد" : "عرض"}</span>}
                  </div>

                  <div className={cn("flex min-w-0 flex-1 flex-col gap-1", columns === 4 ? "p-1.5 sm:p-3" : "p-2.5 sm:p-3")}>
                    <p className={cn("line-clamp-2 font-semibold leading-snug", columns === 4 ? "min-h-8 text-[11px] sm:min-h-10 sm:text-sm" : "min-h-10 text-sm")}>{product.name}</p>
                    <p className="truncate text-[10px] text-slate-500 sm:text-[11px]">{product.itemNumber}</p>
                    <p className={cn("mt-auto break-words font-bold tabular-nums", columns === 4 ? "text-xs sm:text-base" : "text-sm sm:text-base")}>
                      {money(mode === "CARTON" ? unitPrice(product, "CARTON", mode) : product.salePrice)} <span className="text-[10px] font-normal sm:text-xs">/ {mode === "CARTON" ? "كارتون" : "قطعة"}</span>
                    </p>
                    <span
                      className={cn(
                        "tabular-nums",
                        low ? "font-semibold text-red-600 dark:text-red-400" : "text-slate-500",
                        // 10px on a phone at four columns only. It stayed 10px
                        // on the iPad too, the one screen the reps actually use.
                        columns === 4 ? "text-[10px] sm:text-xs" : "text-[12px]",
                      )}
                    >
                      {stockText}
                    </span>
                    {held && (
                      <span className={cn("font-semibold text-[var(--theme-accent)] tabular-nums", columns === 4 ? "text-[10px] sm:text-xs" : "text-[12px]")}>
                        بالسلة: {held.map((h) => `${h.quantity} ${UNIT_LABEL[h.unit]}`).join(" + ")}
                      </span>
                    )}
                    <span className={cn("mt-2 flex min-h-10 items-center justify-center gap-1 rounded-xl bg-[var(--theme-accentSoft)] font-semibold text-[var(--theme-accent)] sm:min-h-11", columns === 4 ? "text-[10px] sm:text-sm" : "text-xs sm:text-sm")}>{columns === 4 ? "تفاصيل" : "تفاصيل ووحدات"}</span>
                  </div>
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onQuickAdd(product)}
                  aria-label={`أضف ${mode === "CARTON" ? "كارتون" : "قطعة"}: ${product.name}`}
                  title={mode === "CARTON" ? "أضف كارتون" : "أضف قطعة"}
                  className="absolute start-2 top-2 grid size-11 place-items-center rounded-full bg-[var(--theme-accent)] text-white shadow-md transition-transform active:scale-90 disabled:opacity-40"
                >
                  <Plus className="size-5" />
                </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * The product dialog.
 *
 * Full picture, price for the chosen unit, real stock, and the three things the
 * rep does next: add it, record why the shopkeeper refused it, or ask for a
 * price. All three sit in the footer, within thumb reach.
 */
export function ProductDialog({
  mode,
  canIssue,
  canAskPrice,
  locked,
  product,
  onClose,
  onAdd,
  onIssue,
  onAskPrice,
  specialPrice,
}: {
  mode: AgentMode
  canIssue: boolean
  canAskPrice: boolean
  locked: boolean
  product: AgentProduct
  onClose: () => void
  onAdd: (unit: Unit, quantity: number) => void
  onIssue: (unit: Unit) => void
  onAskPrice: (unit: Unit) => void
  specialPrice: (unit: Unit) => number | null
}) {
  const units = availableUnits(product, mode)
  const [unit, setUnit] = useState<Unit>(() => agentDefaultUnit(mode, product.currentStock))
  const [qty, setQty] = useState(1)
  const qc = useQueryClient()
  const userId = useAuthStore(s => s.user?.id)
  const thumbnail = qc.getQueryData<string | null>(["sales-agent", "thumbnail", userId, product.id])
  const fullImage = useQuery({
    queryKey: ["sales-agent", "full-image", userId, product.id],
    enabled: product.hasImage,
    queryFn: async () => (await api.get<{ data: { imageUrl: string | null } }>(`/sales-agent/products/${product.id}/image`)).data.data.imageUrl,
    placeholderData: thumbnail,
    staleTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  })
  const image = fullImage.data ?? thumbnail

  const max = Math.max(0, maxQty(product, unit))
  const approved = specialPrice(unit)
  // Preview only. `submitAgentOrder` re-resolves the approved price from the
  // database when the order is priced, so what is shown here can never become
  // what gets billed.
  const line = (approved ?? unitPrice(product, unit, mode)) * qty

  return (
    <Dialog
      title={product.name}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="وحدة الطلب">
            {units.map(u => <Button key={u} variant={unit === u ? "default" : "outline"}
              aria-pressed={unit === u} className="h-11 min-w-[4rem] flex-1"
              onClick={() => { setUnit(u); setQty(1) }}>{UNIT_LABEL[u]}</Button>)}
          </div>
          <Button className="h-12 w-full" disabled={locked || !unit || qty > 100000} onClick={() => onAdd(unit, qty)}>
            <Plus className="h-4 w-4" /> أضف للطلب · {money(line)}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={!canIssue} className="h-11 flex-1" onClick={() => onIssue(unit)}>
              <AlertTriangle className="h-4 w-4" /> أكو مشكلة
            </Button>
            <Button variant="outline" disabled={!canAskPrice} className="h-11 flex-1" onClick={() => onAskPrice(unit)}>
              <BadgePercent className="h-4 w-4" /> اطلب سعر
            </Button>
          </div>
        </div>
      }
    >
      <div className="mx-auto aspect-square w-full max-w-[26rem] shrink-0 overflow-hidden rounded-2xl bg-white">
        {image ? (
          <img src={image} alt={product.name} className="h-full w-full object-contain" />
        ) : (
          <div className="grid h-full w-full place-items-center text-slate-400">
            <Package className="h-10 w-10" />
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <span className="rounded bg-slate-100 px-2.5 py-1.5 font-medium tabular-nums dark:bg-slate-800">
          القطعة {money(mode === "CARTON" ? Number(product.cartonPiecePrice) : product.salePrice)}
        </span>
        <span className="rounded bg-slate-100 px-2.5 py-1.5 font-medium tabular-nums dark:bg-slate-800">
          المتوفر {product.currentStock} قطعة
        </span>
        <span className="rounded bg-slate-100 px-2.5 py-1.5 font-medium dark:bg-slate-800">
          {product.itemNumber}
        </span>
      </div>

      {mode === "CARTON" && <p className="mt-3 text-sm text-slate-500">الكارتون {product.pcsPerCarton} قطعة · السعر الخاص بالموافقة متاح بوضع الجملة فقط.</p>}

      {approved != null && (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/30">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
            <BadgePercent className="h-4 w-4" /> سعر خاص موافق عليه
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
            {money(approved)}
          </p>
          <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-400">
            ينطبق على هذا الطلب فقط، ويُستهلك أول ما ترسل الطلب.
          </p>
        </div>
      )}

      <div className="mt-5">
        <p className="mb-2 text-[13px] font-medium text-slate-600 dark:text-slate-300">
          الكمية {max > 0 ? <span className="tabular-nums">(المتوفر يكفي {max})</span> : null}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-11 w-11 p-0" aria-label="أنقص" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            <Minus className="h-4 w-4" />
          </Button>
          <Input
            value={qty}
            inputMode="numeric"
            aria-label="الكمية"
            onChange={(e) => setQty(wholeUnits(e.target.value))}
            className="h-11 w-20 text-center text-base font-bold tabular-nums"
          />
          <Button variant="outline" className="h-11 w-11 p-0" aria-label="زد" onClick={() => setQty((q) => Math.min(100000, q + 1))}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="mt-5 text-lg font-bold tabular-nums">المجموع {money(line)}</p>
    </Dialog>
  )
}

/* ── cart ────────────────────────────────────────────────────────────── */
