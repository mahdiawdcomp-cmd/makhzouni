/**
 * «الطلبات المعلّقة» — attempts this device sent but never got an answer for.
 *
 * The rules this screen exists to make visible:
 *
 *  - An attempt keeps ONE idempotency key for its whole life. «إعادة التحقق»
 *    re-sends that same key, so if the first send did reach the shop the server
 *    hands back the same order instead of creating a twin.
 *  - An unresolved attempt cannot be edited. Editing it would mean sending
 *    different goods under a key the shop may already have accepted — the one
 *    way to actually duplicate or falsify an order. Edit unlocks only after the
 *    server has answered definitively.
 *  - Deleting the draft deletes it HERE. It does not cancel an order that
 *    reached the shop, and the confirmation says exactly that.
 *
 * Nothing on this screen sends anything by itself: every send is a tap. A
 * background retry is what turns one lost answer into three real orders.
 */
import { useState } from "react"
import { Button } from "../../components/ui/button"
import { Card, CardContent } from "../../components/ui/card"
import { AgentDialog, AgentEmptyState, AgentStatusPill } from "./shared"
import { money, sinceLabel } from "./format"
import type { AgentMode, PendingMeta } from "../../utils/salesAgentDrafts"

export type PendingRow = {
  key: string
  mode: AgentMode
  customerId: string | null
  meta?: PendingMeta
  lineCount: number
  /** Absent once settled: there is nothing left to re-send. */
  hasPayload: boolean
}

export function PendingOrdersScreen({
  rows,
  online,
  busyKey,
  customerName,
  onRecheck,
  onEdit,
  onDiscard,
}: {
  rows: PendingRow[]
  online: boolean
  /** The attempt currently being re-checked, so its button alone shows waiting. */
  busyKey: string | null
  customerName: (customerId: string | null) => string
  onRecheck: (row: PendingRow) => void
  onEdit: (row: PendingRow) => void
  onDiscard: (row: PendingRow) => void
}) {
  const [confirming, setConfirming] = useState<PendingRow | null>(null)

  if (rows.length === 0) {
    return (
      <div className="p-4">
        <AgentEmptyState
          title="ماكو طلبات معلّقة"
          body="كل طلباتك وصلت وأخذت تأكيد. إذا انقطع النت وأنت ترسل، الطلب يظهر هنا بمفتاح محاولته حتى تتحقق منه."
        />
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      {!online && (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          ماكو اتصال. الطلبات محفوظة بالجهاز وتنتظرك — لا تنشئ طلب ثاني لنفس الزبون.
        </p>
      )}

      {rows.map((row) => {
        const settled = Boolean(row.meta?.settled) || !row.hasPayload
        const busy = busyKey === row.key
        return (
          <Card key={row.key}>
            <CardContent className="space-y-2 py-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{customerName(row.customerId)}</p>
                  <p className="text-[12px] text-slate-500">
                    {row.mode === "CARTON" ? "توزيع كراتين" : "جملة"} · {row.lineCount} سطر ·{" "}
                    {sinceLabel(row.meta?.createdAt)}
                  </p>
                </div>
                <AgentStatusPill tone={settled ? "bad" : "wait"}>
                  {settled ? "المحاولة انتهت" : "بانتظار الاتصال"}
                </AgentStatusPill>
              </div>

              {typeof row.meta?.subtotal === "number" && row.meta.subtotal > 0 && (
                <p className="text-sm">الإجمالي وقت الإرسال: {money(row.meta.subtotal)}</p>
              )}

              <p className="rounded-lg bg-slate-50 p-2 text-[12px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                {row.meta?.reason
                  ? `السبب: ${row.meta.reason}`
                  : "ما وصل تأكيد من السيرفر. حالة الإرسال غير مؤكدة."}
                {row.meta?.attempts ? ` · عدد المحاولات: ${row.meta.attempts}` : ""}
              </p>

              <div className="flex flex-wrap gap-2 pt-1">
                {!settled && (
                  <Button className="h-11 flex-1" disabled={!online || busy} onClick={() => onRecheck(row)}>
                    {busy ? "جاري التحقق…" : "إعادة التحقق بنفس المحاولة"}
                  </Button>
                )}
                <Button
                  className="h-11 flex-1"
                  variant="outline"
                  disabled={!settled}
                  onClick={() => onEdit(row)}
                  title={settled ? undefined : "تحقق من حالة الإرسال أولاً؛ التعديل قبل ذلك يخلق طلباً مختلفاً بنفس المفتاح"}
                >
                  تعديل الطلب
                </Button>
                <Button className="h-11" variant="outline" onClick={() => setConfirming(row)}>
                  حذف المسودة
                </Button>
              </div>

              {!settled && (
                <p className="text-[12px] text-slate-500">
                  التعديل يفتح بعد ما يرد السيرفر بجواب نهائي — حتى لا يتغير طلب ممكن يكون واصل أصلاً.
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}

      {confirming && (
        <AgentDialog
          title="حذف مسودة الطلب"
          onClose={() => setConfirming(null)}
          footer={
            <div className="flex gap-2">
              <Button className="h-12 flex-1" variant="outline" onClick={() => setConfirming(null)}>
                رجوع
              </Button>
              <Button
                className="h-12 flex-1"
                variant="destructive"
                onClick={() => {
                  onDiscard(confirming)
                  setConfirming(null)
                }}
              >
                احذف المسودة
              </Button>
            </div>
          }
        >
          <p className="font-semibold">{customerName(confirming.customerId)}</p>
          <p className="mt-2 text-sm">
            الحذف يشيل المسودة من هذا الجهاز فقط. إذا كان الطلب قد وصل للمحل فعلاً، الحذف لا يلغيه —
            راجع «طلباتي» أو صاحب المحل قبل الحذف.
          </p>
        </AgentDialog>
      )}
    </div>
  )
}
