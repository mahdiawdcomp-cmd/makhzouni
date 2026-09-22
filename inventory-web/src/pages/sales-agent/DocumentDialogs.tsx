/**
 * «فاتورتي» / «سندي» — what a rep sees when they tap a row of a customer's
 * statement.
 *
 * Every rule lives on the server. These dialogs only say, BEFORE the rep taps,
 * what will happen — applied now, or sent to the owner — so a rep standing in
 * front of a shopkeeper is never surprised by which of the two it was. The
 * server's answer after the tap is the one shown in the end, whatever the
 * preview guessed.
 */
import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Minus, Plus, Trash2 } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { toast } from "../../components/ui/use-toast"
import { apiErrorMessage } from "../../utils/apiError"
import { cn } from "../../utils/cn"
import { AgentDialog, AgentStatusPill } from "./shared"
import { UNIT_LABEL, money, shortDate, type AgentUnit } from "./format"
import { useOnce } from "./hooks"

type Mode = "OFF" | "APPROVAL" | "DIRECT"

type AgentInvoice = {
  id: string
  invoiceNumber: string
  type: string
  status: string
  date: string
  priceMode: string
  subtotal: number
  discount: number
  tax: number
  totalAmount: number
  paidAmount: number
  remainingAmount: number
  notes: string | null
  items: Array<{
    id: string
    productId: string
    productName: string
    itemNumber: string | null
    unit: AgentUnit
    quantity: number
    unitPrice: number
    totalPrice: number
  }>
  mine: boolean
  pending: { id: string; kind: "EDIT" | "CANCEL"; since: string } | null
  can: { edit: Mode; cancel: Mode }
  maxDiscount: number
}

type AgentReceipt = {
  id: string
  voucherNumber: string
  amount: number
  date: string
  notes: string | null
  cancelled: boolean
  mine: boolean
  pending: { id: string; kind: "EDIT" | "CANCEL"; since: string } | null
  can: { edit: Mode; cancel: Mode }
}

/** Keys every screen that shows these documents reads, refreshed after a change. */
function useRefreshAfterChange() {
  const qc = useQueryClient()
  return () => {
    for (const key of ["customer-detail", "customer-header", "customers", "cash", "today", "receipts", "orders"]) {
      void qc.invalidateQueries({ queryKey: ["sales-agent", key] })
    }
    void qc.invalidateQueries({ queryKey: ["sales-agent", "invoice"] })
    void qc.invalidateQueries({ queryKey: ["sales-agent", "receipt"] })
  }
}

function PendingBanner({ pending }: { pending: { kind: "EDIT" | "CANCEL" } }) {
  return (
    <p className="rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      {pending.kind === "CANCEL" ? "طلب الإلغاء" : "طلب التعديل"} ينتظر موافقة صاحب المحل. ما تكدر تغيّر شي لحد ما يقرر.
    </p>
  )
}

/** One sentence the rep reads before they tap, not after. */
function modeNote(mode: Mode, kind: "edit" | "cancel", maxDiscountPct: number) {
  if (mode === "OFF") return null
  if (kind === "cancel") {
    return mode === "DIRECT"
      ? "الإلغاء ينطبق فوراً والبضاعة ترجع للمحل، ويوصل إشعار لصاحب المحل."
      : "الإلغاء يروح لموافقة صاحب المحل."
  }
  return mode === "DIRECT"
    ? `التعديل ينطبق فوراً. خصم أكثر من ${maxDiscountPct}٪ من سعر الكتلوك يروح لموافقة صاحب المحل.`
    : "كل تعديل يروح لموافقة صاحب المحل."
}

export function AgentInvoiceDialog({
  invoiceId,
  onClose,
  catalogUnitPrice,
}: {
  invoiceId: string
  onClose: () => void
  /**
   * Today's catalog price for one unit, from the grid the rep already has, or
   * null. Used ONLY to warn before saving; the server decides.
   */
  catalogUnitPrice: (productId: string, unit: AgentUnit, priceMode: string) => number | null
}) {
  const refresh = useRefreshAfterChange()
  const invoice = useQuery({
    queryKey: ["sales-agent", "invoice", invoiceId],
    queryFn: async () => (await api.get<{ data: AgentInvoice }>(`/sales-agent/invoices/${invoiceId}`)).data.data,
    retry: 2,
  })

  // The editable copy. Re-seeded whenever the server copy changes: an edit
  // REPLACES the invoice's lines, so ids from before a save are dead after it.
  const [lines, setLines] = useState<Array<{ id: string; quantity: number; unitPrice: string; removed: boolean }>>([])
  useEffect(() => {
    if (!invoice.data) return
    setLines(invoice.data.items.map((l) => ({ id: l.id, quantity: l.quantity, unitPrice: String(l.unitPrice), removed: false })))
  }, [invoice.data])

  const [reason, setReason] = useState("")
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState("")

  const data = invoice.data
  const maxPct = Math.round((data?.maxDiscount ?? 0.06) * 100)

  const draft = useMemo(() => {
    if (!data) return { total: 0, changed: false, flagged: new Set<string>() }
    const flagged = new Set<string>()
    let total = 0
    let changed = false
    for (const line of lines) {
      const original = data.items.find((l) => l.id === line.id)
      if (!original) continue
      const price = Number(line.unitPrice)
      if (line.removed) { changed = true; continue }
      total += line.quantity * (Number.isFinite(price) ? price : 0)
      if (line.quantity !== original.quantity || Math.round(price) !== Math.round(original.unitPrice)) changed = true
      const catalog = catalogUnitPrice(original.productId, original.unit, data.priceMode)
      if (catalog && Math.round(price) !== Math.round(original.unitPrice) && price < catalog * (1 - (data.maxDiscount ?? 0.06)) - 1) {
        flagged.add(line.id)
      }
    }
    return { total: total - data.discount + data.tax, changed, flagged }
  }, [data, lines, catalogUnitPrice])

  const save = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => !l.removed)
        .map((l) => ({ itemId: l.id, quantity: l.quantity, unitPrice: Number(l.unitPrice) }))
      const res = await api.put<{ data: { status: "APPLIED" | "PENDING"; reasons: string[] } }>(
        `/sales-agent/invoices/${invoiceId}`,
        { items, reason: reason.trim() || undefined },
      )
      return res.data.data
    },
    onSuccess: (result) => {
      toast(
        result.status === "APPLIED"
          ? { title: "انعدّلت الفاتورة ✓" }
          : { title: "انرسل التعديل لصاحب المحل", description: result.reasons.join(" · ") || undefined },
      )
      refresh()
      setReason("")
    },
    onError: (err) => toast({ title: "ما انحفظ التعديل", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const cancel = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { status: "APPLIED" | "PENDING" } }>(
        `/sales-agent/invoices/${invoiceId}/cancel`,
        { reason: cancelReason.trim() },
      )
      return res.data.data
    },
    onSuccess: (result) => {
      toast({ title: result.status === "APPLIED" ? "انلغت الفاتورة ✓" : "انرسل طلب الإلغاء لصاحب المحل" })
      refresh()
      setCancelling(false)
      setCancelReason("")
      if (result.status === "APPLIED") onClose()
    },
    onError: (err) => toast({ title: "ما انلغت", description: apiErrorMessage(err), variant: "destructive" }),
  })

  // Two taps in one tick both pass a `disabled` that has not re-rendered yet.
  // The server refuses the twin, but the rep would still see an error toast
  // for a save that worked — the page's own one-tap guard stops it here.
  const saveOnce = useOnce(save)
  const cancelOnce = useOnce(cancel)

  const editMode: Mode = data?.can.edit ?? "OFF"
  const cancelMode: Mode = data?.can.cancel ?? "OFF"
  const editable = editMode !== "OFF"
  const busy = save.isPending || cancel.isPending
  const allRemoved = lines.length > 0 && lines.every((l) => l.removed)

  return (
    <AgentDialog
      title={data ? `فاتورة ${data.invoiceNumber}` : "فاتورة"}
      onClose={onClose}
      footer={
        data && (editable || cancelMode !== "OFF") ? (
          <div className="space-y-2">
            {editable && (
              <>
                {draft.flagged.size > 0 && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                    فيه سعر خصمه أكثر من {maxPct}٪ — التعديل كله راح يروح لموافقة صاحب المحل.
                  </p>
                )}
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="سبب التعديل (اختياري)"
                  aria-label="سبب التعديل"
                  className="h-11"
                />
                <Button
                  className="h-12 w-full"
                  disabled={!draft.changed || busy || allRemoved}
                  onClick={saveOnce}
                >
                  {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {editMode === "APPROVAL" || draft.flagged.size > 0 ? "أرسل التعديل للموافقة" : "احفظ التعديل"} · {money(draft.total)}
                </Button>
              </>
            )}
            {cancelMode !== "OFF" && !cancelling && (
              <Button variant="outline" className="h-11 w-full text-red-600" disabled={busy} onClick={() => setCancelling(true)}>
                {cancelMode === "DIRECT" ? "ألغِ الفاتورة" : "اطلب إلغاء الفاتورة"}
              </Button>
            )}
            {cancelling && (
              <div className="space-y-2 rounded-xl border border-red-200 p-3 dark:border-red-900">
                <p className="text-[12px] text-slate-600 dark:text-slate-300">{modeNote(cancelMode, "cancel", maxPct)}</p>
                <Input
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="سبب الإلغاء (لازم)"
                  aria-label="سبب الإلغاء"
                  className="h-11"
                />
                <div className="flex gap-2">
                  <Button
                    className="h-11 flex-1 bg-red-600 hover:bg-red-700"
                    disabled={!cancelReason.trim() || busy}
                    onClick={cancelOnce}
                  >
                    {cancel.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    تأكيد
                  </Button>
                  <Button variant="ghost" className="h-11" onClick={() => setCancelling(false)}>
                    تراجع
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      {invoice.isPending ? (
        <p className="py-8 text-center text-sm text-slate-500">جاري التحميل…</p>
      ) : invoice.error || !data ? (
        <p className="py-8 text-center text-sm text-red-600">{apiErrorMessage(invoice.error, "ما وصلت الفاتورة")}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="tabular-nums text-slate-500">{shortDate(data.date)}</span>
            {data.status !== "ACTIVE" && <AgentStatusPill tone="bad">ملغاة</AgentStatusPill>}
            {data.mine ? (
              <AgentStatusPill tone="ok">فاتورتك</AgentStatusPill>
            ) : (
              <AgentStatusPill tone="muted">من المحل — للقراءة بس</AgentStatusPill>
            )}
          </div>

          {data.pending && <PendingBanner pending={data.pending} />}
          {editable && !data.pending && (
            <p className="text-[12px] text-slate-500">{modeNote(editMode, "edit", maxPct)}</p>
          )}

          <ul className="space-y-2">
            {data.items.map((item) => {
              const line = lines.find((l) => l.id === item.id)
              if (!line) return null
              const flagged = draft.flagged.has(item.id)
              return (
                <li
                  key={item.id}
                  className={cn(
                    "rounded-lg border p-3",
                    line.removed && "opacity-50",
                    flagged && "border-amber-400",
                  )}
                  style={flagged ? undefined : { borderColor: "var(--theme-cardBorder)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("text-[13px] font-medium", line.removed && "line-through")}>{item.productName}</p>
                    {editable && (
                      <button
                        type="button"
                        aria-label={line.removed ? "رجّع السطر" : "احذف السطر"}
                        onClick={() =>
                          setLines((prev) => prev.map((l) => (l.id === item.id ? { ...l, removed: !l.removed } : l)))
                        }
                        className="-m-1.5 grid size-11 shrink-0 place-items-center rounded text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>

                  {editable && !line.removed ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          className="size-11 p-0"
                          aria-label="أنقص"
                          onClick={() =>
                            setLines((prev) => prev.map((l) => (l.id === item.id ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l)))
                          }
                        >
                          <Minus className="size-4" />
                        </Button>
                        <span className="min-w-9 text-center font-bold tabular-nums">{line.quantity}</span>
                        <Button
                          variant="outline"
                          className="size-11 p-0"
                          aria-label="زد"
                          onClick={() =>
                            setLines((prev) => prev.map((l) => (l.id === item.id ? { ...l, quantity: Math.min(100000, l.quantity + 1) } : l)))
                          }
                        >
                          <Plus className="size-4" />
                        </Button>
                        <span className="ms-1 text-[12px] text-slate-500">{UNIT_LABEL[item.unit]}</span>
                      </div>
                      <label className="flex items-center gap-1 text-[12px] text-slate-500">
                        السعر
                        <Input
                          value={line.unitPrice}
                          inputMode="numeric"
                          aria-label={`سعر ${item.productName}`}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^\d.]/g, "")
                            setLines((prev) => prev.map((l) => (l.id === item.id ? { ...l, unitPrice: value } : l)))
                          }}
                          className="h-11 w-28 text-center font-bold tabular-nums"
                        />
                      </label>
                    </div>
                  ) : (
                    <p className="mt-1 text-[12px] tabular-nums text-slate-500">
                      {item.quantity} {UNIT_LABEL[item.unit]} × {money(item.unitPrice)} = {money(item.totalPrice)}
                    </p>
                  )}
                  {flagged && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">خصم أكثر من {maxPct}٪ — يحتاج موافقة</p>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="space-y-1 border-t pt-3 text-[13px] tabular-nums" style={{ borderColor: "var(--theme-cardBorder)" }}>
            <div className="flex justify-between"><span className="text-slate-500">المجموع</span><span className="font-bold">{money(data.totalAmount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">المدفوع</span><span>{money(data.paidAmount)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">الباقي</span><span>{money(data.remainingAmount)}</span></div>
          </div>
          {editable && (
            <p className="text-[11px] text-slate-500">
              تريد تضيف مادة؟ سوّيها بطلب جديد من الكتلوك — التعديل يغيّر الموجود بس.
            </p>
          )}
        </div>
      )}
    </AgentDialog>
  )
}

export function AgentReceiptDialog({ voucherId, onClose }: { voucherId: string; onClose: () => void }) {
  const refresh = useRefreshAfterChange()
  const receipt = useQuery({
    queryKey: ["sales-agent", "receipt", voucherId],
    queryFn: async () => (await api.get<{ data: AgentReceipt }>(`/sales-agent/receipts/${voucherId}`)).data.data,
    retry: 2,
  })
  const [action, setAction] = useState<"edit" | "cancel" | null>(null)
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")

  const request = useMutation({
    mutationFn: async () => {
      if (action === "edit") {
        await api.post(`/sales-agent/receipts/${voucherId}/edit-request`, { amount: Number(amount), reason: reason.trim() })
      } else {
        await api.post(`/sales-agent/receipts/${voucherId}/cancel-request`, { reason: reason.trim() })
      }
    },
    onSuccess: () => {
      toast({ title: action === "edit" ? "انرسل طلب تعديل السند" : "انرسل طلب إلغاء السند", description: "ينتظر موافقة صاحب المحل" })
      refresh()
      setAction(null)
      setReason("")
    },
    onError: (err) => toast({ title: "ما انرسل", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const requestOnce = useOnce(request)
  const data = receipt.data
  const allowed = data && data.can.edit !== "OFF"

  return (
    <AgentDialog title={data ? `سند ${data.voucherNumber}` : "سند"} onClose={onClose}>
      {receipt.isPending ? (
        <p className="py-8 text-center text-sm text-slate-500">جاري التحميل…</p>
      ) : receipt.error || !data ? (
        <p className="py-8 text-center text-sm text-red-600">{apiErrorMessage(receipt.error, "ما وصل السند")}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="tabular-nums text-slate-500">{shortDate(data.date)}</span>
            {data.cancelled && <AgentStatusPill tone="bad">ملغي</AgentStatusPill>}
            {data.mine ? <AgentStatusPill tone="ok">سندك</AgentStatusPill> : <AgentStatusPill tone="muted">من المحل — للقراءة بس</AgentStatusPill>}
          </div>
          <p className="text-2xl font-bold tabular-nums">{money(data.amount)}</p>
          {data.notes && <p className="text-[13px] text-slate-600 dark:text-slate-300">{data.notes}</p>}
          {data.pending && <PendingBanner pending={data.pending} />}

          {allowed && !action && (
            <>
              {/* Said up front: a receipt is cash in the rep's hand, and no
                  setting lets them change one on their own. */}
              <p className="text-[12px] text-slate-500">تعديل أو إلغاء سند القبض يروح دائماً لموافقة صاحب المحل.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="h-11 flex-1" onClick={() => { setAction("edit"); setAmount(String(data.amount)) }}>
                  اطلب تعديل المبلغ
                </Button>
                <Button variant="outline" className="h-11 flex-1 text-red-600" onClick={() => setAction("cancel")}>
                  اطلب إلغاء
                </Button>
              </div>
            </>
          )}

          {action && (
            <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: "var(--theme-cardBorder)" }}>
              {action === "edit" && (
                <Input
                  value={amount}
                  inputMode="numeric"
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                  aria-label="المبلغ الصحيح"
                  placeholder="المبلغ الصحيح"
                  className="h-11 text-lg font-bold tabular-nums"
                />
              )}
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="السبب (لازم)"
                aria-label="السبب"
                className="h-11"
              />
              <div className="flex gap-2">
                <Button
                  className="h-11 flex-1"
                  disabled={!reason.trim() || request.isPending || (action === "edit" && !(Number(amount) > 0))}
                  onClick={requestOnce}
                >
                  {request.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  أرسل للموافقة
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => setAction(null)}>
                  تراجع
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </AgentDialog>
  )
}
