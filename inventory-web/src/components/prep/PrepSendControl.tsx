import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Bell, BellRing, Flame, Loader2, Printer, X } from "lucide-react"
import { printPrepSlip } from "../../utils/printPrepSlip"
import { apiErrorMessage } from "../../utils/apiError"
import { cancelPrepOrder, getPrepWorkers, sendPrepOrder } from "../../api/endpoints"
import type { PrepOrder, PrepSnapshot } from "../../utils/prepScreen"
import { toast } from "../ui/use-toast"
import { cn } from "../../utils/cn"

// «أرسل للتجهيز» — only the invoices the cashier sends reach the workers'
// phones (the upstairs monitor still mirrors every invoice). Sent early, the
// order keeps syncing as lines are added. Options: urgent 🔥, a note (the
// server translates it to Urdu), one worker or all. F9 opens it.

type Options = { urgent: boolean; note: string; targetUserId: string | null }

export function PrepSendControl({ getSnapshot, order, hasLines }: {
  /** Latest snapshot of this invoice, as published to the prep screen. */
  getSnapshot: () => PrepSnapshot | null
  /** This invoice's order on the server, once it exists. */
  order: PrepOrder | undefined
  hasLines: boolean
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [opts, setOpts] = useState<Options>({ urgent: false, note: "", targetUserId: null })
  // Pressed before the first line: send automatically once a line exists.
  const [armed, setArmed] = useState<Options | null>(null)
  const noteRef = useRef<HTMLInputElement>(null)

  const workers = useQuery({ queryKey: ["prep-workers"], queryFn: getPrepWorkers, enabled: open, staleTime: 60_000 })

  const sent = order?.sent && !order.cancelled ? order.sent : null

  async function doSend(o: Options) {
    const snapshot = getSnapshot()
    if (!snapshot || snapshot.lines.length === 0) return
    setBusy(true)
    try {
      await sendPrepOrder({ snapshot, urgent: o.urgent, note: o.note.trim() || null, targetUserId: o.targetUserId })
      toast({ title: o.urgent ? "🔥 انرسل للتجهيز (مستعجل)" : "🔔 انرسل للتجهيز" })
    } catch (err) {
      toast({ variant: "destructive", title: "ما انرسل للتجهيز", description: apiErrorMessage(err, "تأكد من الإنترنت وحاول مرة ثانية") })
    } finally {
      setBusy(false)
    }
  }

  function submit() {
    setOpen(false)
    if (!hasLines) {
      setArmed(opts)
      toast({ title: "⏳ راح ينرسل مع أول صنف تضيفه" })
      return
    }
    void doSend(opts)
  }

  // Armed → first line added → send. Deferred a beat so the page has
  // published the snapshot that now carries the line.
  useEffect(() => {
    if (!armed || !hasLines) return
    const t = setTimeout(() => { void doSend(armed).then(() => setArmed(null)) }, 600)
    return () => clearTimeout(t)
  }, [armed, hasLines]) // eslint-disable-line react-hooks/exhaustive-deps

  // F9 opens the dialog from anywhere on the invoice.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F9") { e.preventDefault(); setOpen(true) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => { if (open) setTimeout(() => noteRef.current?.focus(), 50) }, [open])

  async function cancel() {
    if (!order) return
    setOpen(false)
    try {
      await cancelPrepOrder(order.snapshot.draftId)
      toast({ title: "❌ انلغى التجهيز", description: "وصل للعمال إشعار يوكفون" })
    } catch {
      toast({ variant: "destructive", title: "ما انلغى — حاول مرة ثانية" })
    }
  }

  let label = "أرسل للتجهيز"
  let tone = "border-white/30 bg-white/20 hover:bg-white/30"
  if (armed) { label = "⏳ ينرسل مع أول صنف"; tone = "border-amber-300 bg-amber-500/80 hover:bg-amber-500" }
  else if (order?.ready) { label = `✅ جاهز — ${order.ready.by}`; tone = "border-emerald-300 bg-emerald-600 hover:bg-emerald-500" }
  else if (sent?.ack) { label = `👍 ${sent.ack.by} استلم`; tone = "border-emerald-300 bg-emerald-600/80 hover:bg-emerald-600" }
  else if (sent) { label = "انرسل — بانتظار الاستلام"; tone = "animate-pulse border-sky-300 bg-sky-600 hover:bg-sky-500" }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        title="أرسل الطلب لموبايلات عمال التجهيز (F9)"
        className={cn("inline-flex h-7 items-center gap-1.5 rounded border px-2 text-xs font-bold text-white", tone)}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : sent ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
        {sent?.urgent && <Flame className="h-3.5 w-3.5 text-orange-200" />}
        {label}
        <kbd className="rounded bg-black/20 px-1 text-[10px] font-normal">F9</kbd>
      </button>
      <button
        type="button"
        title="اطبع ورقة تجهيز (صور وأعداد، بدون أسعار) — تشتغل حتى بدون إنترنت"
        disabled={!hasLines}
        onClick={() => {
          const s = getSnapshot()
          if (!s || s.lines.length === 0) return
          if (!printPrepSlip(s, { note: sent?.note ?? null, urgent: sent?.urgent })) {
            toast({ variant: "destructive", title: "المتصفح منع نافذة الطباعة", description: "اسمح بالنوافذ المنبثقة لهذا الموقع" })
          }
        }}
        className="inline-flex h-7 items-center gap-1 rounded border border-white/30 bg-white/20 px-2 text-xs font-medium text-white hover:bg-white/30 disabled:opacity-40"
      >
        <Printer className="h-3.5 w-3.5" /> ورقة تجهيز
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-lg font-bold">
                <BellRing className="h-5 w-5 text-sky-600" /> أرسل للتجهيز
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            {sent && (
              <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800">
                <div>انرسل {sent.targetName ? `إلى ${sent.targetName}` : "لكل العمال"}{sent.urgent ? " · 🔥 مستعجل" : ""}</div>
                <div className="mt-1 font-semibold">
                  {sent.ack ? `👍 استلمه ${sent.ack.by}` : `⏳ ما محد استلمه بعد${sent.reminders ? ` — رنّ ${sent.reminders} مرات تذكير` : ""}`}
                </div>
              </div>
            )}

            <label className="mb-1 block text-sm font-semibold">لمن؟</label>
            <select
              value={opts.targetUserId ?? ""}
              onChange={(e) => setOpts((o) => ({ ...o, targetUserId: e.target.value || null }))}
              className="mb-4 h-10 w-full rounded-lg border bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="">كل العمال</option>
              {(workers.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>

            <label className="mb-4 flex cursor-pointer items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 dark:border-orange-900 dark:bg-orange-950/30">
              <input
                type="checkbox"
                checked={opts.urgent}
                onChange={(e) => setOpts((o) => ({ ...o, urgent: e.target.checked }))}
                className="h-5 w-5 accent-orange-600"
              />
              <Flame className="h-5 w-5 text-orange-600" />
              <span className="font-bold text-orange-700 dark:text-orange-300">مستعجل — الزبون واكف ينتظر</span>
            </label>

            <label className="mb-1 block text-sm font-semibold">ملاحظة للعامل (تنترجم أوردو تلقائياً)</label>
            <input
              ref={noteRef}
              value={opts.note}
              maxLength={300}
              onChange={(e) => setOpts((o) => ({ ...o, note: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit() } }}
              placeholder="مثلاً: الكارتون الجديد مو القديم"
              className="mb-5 h-10 w-full rounded-lg border bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={submit}
                className={cn("flex-1 rounded-xl py-3 font-bold text-white", opts.urgent ? "bg-orange-600 hover:bg-orange-500" : "bg-sky-600 hover:bg-sky-500")}
              >
                {sent ? "أعد الإرسال" : "أرسل"} <span className="text-xs font-normal opacity-80">(Enter)</span>
              </button>
              {sent && (
                <button type="button" onClick={cancel} className="rounded-xl border border-red-300 px-4 py-3 font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                  ❌ إلغاء التجهيز
                </button>
              )}
              {armed && (
                <button type="button" onClick={() => { setArmed(null); setOpen(false) }} className="rounded-xl border px-4 py-3 font-bold text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800">
                  ما أريد
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
