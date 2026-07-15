import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Building2, Loader2, Send, User, Users } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import { toast } from "./ui/use-toast"
import { getSettings, getWhatsAppStatus, sendInvoiceToWorkers, type WhatsAppSendChannel } from "../api/endpoints"
import { apiErrorMessage } from "../utils/apiError"

/**
 * Reusable modal to send an invoice PDF to selected preparation workers
 * ("عمال التجهيز"). Lists only ACTIVE workers from settings; nothing is
 * auto-selected or auto-sent. A WhatsApp failure surfaces as a toast and never
 * blocks the surrounding flow (invoice creation / catalog approval).
 *
 * The send goes to multiple workers server-side, so only the two server
 * channels apply — official (Meta Cloud) and personal (Green API). The wa.me
 * "web" channel can't fan out to several chats, so it isn't offered here.
 */
export function WorkerSendModal({
  invoiceId,
  open,
  onClose,
}: {
  invoiceId: string | null
  open: boolean
  onClose: () => void
}) {
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings, enabled: open })
  const statusQuery = useQuery({ queryKey: ["whatsapp-status"], queryFn: getWhatsAppStatus, enabled: open, staleTime: 30_000 })
  const activeWorkers = useMemo(
    () => (settingsQuery.data?.preparationWorkers ?? []).filter((w) => w.active && w.phone?.trim()),
    [settingsQuery.data],
  )
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  // Which server channels are usable right now.
  const channels = statusQuery.data?.channels
  const officialAvailable = channels ? channels.official.configured : true
  const personalAvailable = channels ? channels.personal.enabled && channels.personal.configured : false
  const [channel, setChannel] = useState<WhatsAppSendChannel>("official")
  // Keep the pick valid against availability.
  const effectiveChannel: WhatsAppSendChannel =
    channel === "personal" && !personalAvailable ? "official"
    : channel === "official" && !officialAvailable && personalAvailable ? "personal"
    : channel

  const toggle = (phone: string) => setSelected((s) => ({ ...s, [phone]: !s[phone] }))

  const send = useMutation({
    mutationFn: () => {
      const phones = activeWorkers.filter((w) => selected[w.phone]).map((w) => w.phone)
      if (!invoiceId || phones.length === 0) throw new Error("NO_SELECTION")
      return sendInvoiceToWorkers(invoiceId, phones, effectiveChannel)
    },
    onSuccess: (res) => {
      const d = res.data
      const ok = d?.sent?.length ?? 0
      const failed = d?.failed?.length ?? 0
      toast({
        title: failed
          ? `تم الإرسال إلى ${ok} عامل، وفشل ${failed}`
          : `تم إرسال الفاتورة إلى ${ok} عامل للتجهيز ✓`,
        variant: failed ? "destructive" : undefined,
      })
      setSelected({})
      onClose()
    },
    onError: (err) => {
      if ((err as Error)?.message === "NO_SELECTION") {
        toast({ title: "اختر عاملاً واحداً على الأقل", variant: "destructive" })
        return
      }
      toast({ title: "فشل إرسال الفاتورة للعامل", description: apiErrorMessage(err, "تحقق من إعدادات واتساب"), variant: "destructive" })
    },
  })

  const anySelected = activeWorkers.some((w) => selected[w.phone])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            إرسال الفاتورة لعامل التجهيز
          </DialogTitle>
        </DialogHeader>

        {activeWorkers.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            لا يوجد عمال مفعّلين. أضِفهم من <strong>الإعدادات ← واتساب ← عمال التجهيز</strong>.
          </p>
        ) : (
          <div className="space-y-2 py-2">
            {activeWorkers.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => toggle(w.phone)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
                  selected[w.phone]
                    ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                <span className="font-medium">{w.name || w.phone}</span>
                <span className="text-xs text-slate-400" dir="ltr">{w.phone}</span>
              </button>
            ))}
          </div>
        )}

        {/* Channel — official / personal. Only shown when both are usable, so a
            single-channel shop isn't nagged with a pointless choice. */}
        {activeWorkers.length > 0 && officialAvailable && personalAvailable && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-slate-500">الإرسال من:</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setChannel("official")}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  effectiveChannel === "official"
                    ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                <Building2 className="h-4 w-4 text-emerald-600" /> رقم المحل
              </button>
              <button
                type="button"
                onClick={() => setChannel("personal")}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                  effectiveChannel === "personal"
                    ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/40"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                <User className="h-4 w-4 text-indigo-600" /> الرقم الشخصي
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-center gap-3 pt-2">
          <Button disabled={!anySelected || send.isPending || !invoiceId} onClick={() => send.mutate()}>
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {send.isPending ? "جاري الإرسال..." : "إرسال للتجهيز"}
          </Button>
          <Button variant="outline" disabled={send.isPending} onClick={onClose}>إغلاق</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
