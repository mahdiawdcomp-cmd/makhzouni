/**
 * «راجع الطلب قبل الإرسال» — the one door an order goes through.
 *
 * Everything shown here comes from the server's review endpoint: the prices,
 * the available quantities, the offer on a line, and the note about what the
 * customer paid last time. The cart's own arithmetic is never what gets sent,
 * and `reviewToken` is what the server checks on send — if a price or a
 * quantity moved in between, the send is refused and the rep reviews again.
 *
 * The send button is disabled while a send is in flight and while the device is
 * offline, and the caller additionally holds a lock, so a double tap cannot
 * produce two orders.
 */
import { Button } from "../../components/ui/button"
import { AgentDialog, AgentStatusPill, PriceChangeNote } from "./shared"
import { UNIT_LABEL, money, shortDate } from "./format"
import type { OrderReview } from "./types"

export function OrderReviewDialog({
  review,
  mode,
  notes,
  online,
  sending,
  isRetry,
  reviewChanged,
  knownStock,
  locationNote,
  onClose,
  onConfirm,
}: {
  review: OrderReview
  mode: "WHOLESALE" | "CARTON"
  notes: string
  online: boolean
  sending: boolean
  /** True when this is a re-check of an attempt whose answer never arrived. */
  isRetry: boolean
  reviewChanged: boolean
  /** The quantity the rep's catalog showed, to point out what moved since. */
  knownStock: (productId: string) => number | null
  onClose: () => void
  onConfirm: () => void
  /**
   * What the rep should know about their own position before confirming.
   *
   * Shown to the REP first, deliberately. A distance the owner sees in a
   * report but the rep never saw is an ambush; a distance the rep read and
   * confirmed is a fact both of them agreed on.
   */
  locationNote?: { text: string; tone: "ok" | "wait" | "bad" } | null
}) {
  const stockMoved = review.items.filter((item) => {
    const known = knownStock(item.productId)
    return known !== null && known !== item.availableStock
  })

  return (
    <AgentDialog
      title="راجع الطلب قبل الإرسال"
      onClose={onClose}
      footer={
        <Button
          className="h-12 w-full"
          disabled={sending || !online}
          onClick={onConfirm}
        >
          {sending
            ? "بانتظار تأكيد السيرفر…"
            : !online
              ? "ماكو اتصال — الطلب محفوظ ولم يُرسل"
              : isRetry
                ? "تحقق من الطلب بنفس المحاولة"
                : "تأكيد وإرسال الطلب"}
        </Button>
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{review.customerName}</p>
          {review.customerPhone && <p className="text-sm text-slate-500">{review.customerPhone}</p>}
        </div>
        <AgentStatusPill tone={online ? "ok" : "wait"}>
          {online ? "متصل" : "بدون اتصال"}
        </AgentStatusPill>
      </div>

      <p className="mb-3 mt-1 text-sm text-slate-500">
        {mode === "CARTON" ? "توزيع كراتين" : "جملة"} · الطلب يُرسل للموافقة، مو فاتورة نهائية
      </p>

      {typeof review.customerBalance === "number" && review.customerBalance !== 0 && (
        <p className="mb-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          رصيد الزبون قبل هذا الطلب: {money(review.customerBalance)}
          <span className="block text-[12px] text-slate-500">
            للعرض فقط — إرسال الطلب لا يغيّر الرصيد، الرصيد يتغير عند الفاتورة.
          </span>
        </p>
      )}

      {locationNote && (
        <p
          className={
            locationNote.tone === "ok"
              ? "mb-3 rounded-xl bg-emerald-50 p-3 text-[13px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              : locationNote.tone === "bad"
                ? "mb-3 rounded-xl bg-red-50 p-3 text-[13px] text-red-800 dark:bg-red-950/40 dark:text-red-200"
                : "mb-3 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          }
        >
          {locationNote.text}
        </p>
      )}

      {reviewChanged && (
        <p role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          تغيّر السعر أو المتوفر عن العرض السابق؛ راجع القيم المحدّثة أدناه.
        </p>
      )}

      {stockMoved.length > 0 && (
        <p role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          تغيّر المخزون عن اللي كان ظاهر لك:{" "}
          {stockMoved
            .map((item) => `${item.productName} (كان ${knownStock(item.productId)} وصار ${item.availableStock})`)
            .join("، ")}
        </p>
      )}

      <ul className="space-y-3">
        {review.items.map((item, i) => (
          <li key={`${item.productId}:${item.unit}:${i}`} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 font-semibold">{item.productName}</p>
              {item.priceSource === "OFFER" && <AgentStatusPill tone="ok">عرض خاص</AgentStatusPill>}
              {item.priceSource === "APPROVED_REQUEST" && <AgentStatusPill tone="ok">سعر موافَق عليه</AgentStatusPill>}
            </div>
            <p className="mt-1 text-sm">
              {item.quantity} {UNIT_LABEL[item.unit]} × {money(item.unitPrice)} = {money(item.totalPrice)}
            </p>
            {item.offer && (
              <p className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-300">
                السعر الطبيعي {money(item.offer.catalogPrice ?? item.unitPrice)} · العرض فعال لغاية نهاية يوم{" "}
                {item.offer.endsOnDate ?? shortDate(item.offer.endsAt)}
                {item.offer.note ? ` · ${item.offer.note}` : ""}
              </p>
            )}
            {item.specialPrice && (
              <p className="mt-1 text-[12px] text-emerald-700 dark:text-emerald-300">
                السعر الطبيعي {money(item.specialPrice.catalogPrice)} — هذا سعر خاص موافَق عليه لهذا الطلب.
              </p>
            )}
            <PriceChangeNote change={item.priceChange} />
            <p className="mt-1 text-[12px] text-slate-500">المتوفر بالمحل: {item.availableStock}</p>
          </li>
        ))}
      </ul>

      {review.shortages.length > 0 && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          نقص مخزون، سيظهر للمالك:{" "}
          {review.shortages.map((s) => `${s.productName}: ${s.short} قطعة`).join("، ")}
          <span className="block text-[12px]">النقص ما يمنع الطلب — المالك يشوفه ويقرر.</span>
        </div>
      )}

      {notes && <p className="mt-3 whitespace-pre-wrap text-sm">الملاحظة: {notes}</p>}

      <p className="mt-5 text-xl font-bold">المجموع: {money(review.subtotal)}</p>
      {isRetry && (
        <p className="mt-2 rounded-xl bg-amber-50 p-3 text-[12px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          هذي إعادة تحقق لنفس المحاولة، مو طلب ثاني. إذا كان الطلب واصل أول مرة، راح يرجعلك نفس الطلب بدون تكرار.
        </p>
      )}
    </AgentDialog>
  )
}
