// «جرد الفاتورة» — the two link buttons on the invoice screen.
//
// A worker link says "count this before it leaves the shop"; a customer link
// says "count what reached you". They are not the same errand and not the same
// trust level: a worker's count rewrites the invoice on submit, a customer's
// waits for the owner's approval. That asymmetry lives in the backend — this
// component only mints the links and hands them over.
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Copy, Loader2, Truck, UserCheck } from "lucide-react"

import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { toast } from "./ui/use-toast"
import { WhatsAppChannelDialog, type PickedChannel } from "./WhatsAppChannelDialog"
import {
  createInvoiceCountLink,
  getInvoiceCountLinks,
  sendWhatsAppMessage,
  type CountLinkAudience,
  type InvoiceCountLink,
} from "../api/endpoints"
import { apiErrorMessage } from "../utils/apiError"
import { useSettings } from "../hooks/useSettings"
import { cn } from "../utils/cn"

/** The shop's public origin — the desktop build has no usable window origin. */
function publicOrigin(catalogPublicUrl?: string | null): string {
  const configured = catalogPublicUrl?.trim().replace(/\/catalog.*$/, "").replace(/\/$/, "")
  if (configured) return configured
  return window.location.origin
}

export function countLinkUrl(token: string, catalogPublicUrl?: string | null) {
  return `${publicOrigin(catalogPublicUrl)}/invoice-count/${token}`
}

const LIVE_STATUSES = new Set(["OPEN", "VIEWED"])

export function InvoiceCountLinks({
  invoiceId,
  invoiceNumber,
  customerName,
  customerPhone,
  disabled,
  disabledReason,
}: {
  invoiceId: string
  invoiceNumber: string
  customerName: string
  customerPhone?: string | null
  disabled?: boolean
  disabledReason?: string
}) {
  const queryClient = useQueryClient()
  const { data: settings } = useSettings()
  const [workerPickerOpen, setWorkerPickerOpen] = useState(false)
  const [confirmCustomerOpen, setConfirmCustomerOpen] = useState(false)
  const [created, setCreated] = useState<InvoiceCountLink | null>(null)
  const [channelOpen, setChannelOpen] = useState(false)
  const [sending, setSending] = useState(false)

  const linksQ = useQuery({
    queryKey: ["invoice-count-links", invoiceId],
    queryFn: () => getInvoiceCountLinks(invoiceId),
    enabled: !!invoiceId,
  })

  const links = linksQ.data ?? []
  const liveWorkerLink = links.find((l) => l.audience === "WORKER" && LIVE_STATUSES.has(l.status))
  const workerFinished = links.some((l) => l.audience === "WORKER" && l.status === "SUBMITTED")

  const workers = useMemo(
    () => (settings?.preparationWorkers ?? []).filter((w) => w.active && w.phone?.trim()),
    [settings?.preparationWorkers],
  )

  const createMutation = useMutation({
    mutationFn: (payload: { audience: CountLinkAudience; workerId?: string }) =>
      createInvoiceCountLink(invoiceId, payload),
    onSuccess: (link) => {
      if (!link) return
      setWorkerPickerOpen(false)
      setConfirmCustomerOpen(false)
      setCreated(link)
      void queryClient.invalidateQueries({ queryKey: ["invoice-count-links", invoiceId] })
    },
    onError: (error) => {
      toast({
        title: "تعذر إنشاء رابط الجرد",
        description: apiErrorMessage(error, "حاول مرة أخرى"),
        variant: "destructive",
      })
    },
  })

  const url = created ? countLinkUrl(created.token, settings?.catalogPublicUrl) : ""
  const message = created ? buildMessage(created, invoiceNumber, url) : ""

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: "تم نسخ الرابط" })
    } catch {
      toast({ title: "تعذر النسخ — انسخ الرابط يدوياً", variant: "destructive" })
    }
  }

  async function sendOnChannel(channel: PickedChannel) {
    if (!created?.recipientPhone) return
    setSending(true)
    try {
      await sendWhatsAppMessage({ phone: created.recipientPhone, message, channel })
      toast({ title: "تم إرسال رابط الجرد ✓" })
      setChannelOpen(false)
      setCreated(null)
    } catch (error) {
      toast({
        title: "تعذر الإرسال",
        description: apiErrorMessage(error, "تحقق من إعدادات واتساب"),
        variant: "destructive",
      })
    } finally {
      setSending(false)
    }
  }

  const customerDisabled = disabled || !customerPhone?.trim()
  const customerTitle = disabled
    ? disabledReason
    : !customerPhone?.trim()
      ? "هذا الزبون ما عنده رقم هاتف — أضف الرقم أولاً"
      : "رابط يفتح الفاتورة للزبون ليجرد ما وصله (3 أيام)"

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || workers.length === 0}
        title={
          disabled
            ? disabledReason
            : workers.length === 0
              ? "أضف عمال التجهيز من الإعدادات أولاً"
              : "رابط يجرد فيه العامل الفاتورة قبل خروجها (يوم واحد)"
        }
        onClick={() => setWorkerPickerOpen(true)}
      >
        <Truck className="h-3.5 w-3.5 text-sky-600" /> رابط جرد للعامل
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={customerDisabled}
        title={customerTitle}
        onClick={() => {
          // The worker was asked to count and has not answered yet — sending the
          // customer's link now means they may count a document that is about to
          // change. Allowed, but not silently.
          if (liveWorkerLink && !workerFinished) setConfirmCustomerOpen(true)
          else createMutation.mutate({ audience: "CUSTOMER" })
        }}
      >
        <UserCheck className="h-3.5 w-3.5 text-indigo-600" /> رابط جرد للزبون
      </Button>

      {/* ── Pick the worker ── */}
      <Dialog open={workerPickerOpen} onOpenChange={(open) => !open && setWorkerPickerOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>لأي عامل ترسل رابط الجرد؟</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            جرد العامل يُطبَّق على الفاتورة مباشرة، ويصلك خبره في الإشعارات.
          </p>
          <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
            {workers.map((worker) => (
              <button
                key={worker.id}
                type="button"
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate({ audience: "WORKER", workerId: worker.id })}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-right transition",
                  "hover:bg-muted disabled:opacity-50",
                )}
              >
                <span className="font-semibold">{worker.name}</span>
                <span className="text-xs text-muted-foreground" dir="ltr">{worker.phone}</span>
              </button>
            ))}
          </div>
          {createMutation.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> جاري إنشاء الرابط...
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Warn before overlapping the worker's count ── */}
      <Dialog open={confirmCustomerOpen} onOpenChange={(open) => !open && setConfirmCustomerOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>العامل لسه ما خلّص جرده</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-relaxed">
            أرسلت رابط جرد إلى <span className="font-bold">{liveWorkerLink?.recipientName}</span> ولم يُرسل جرده بعد.
            إذا جرد بعد أن يجرد الزبون، ستتغيّر الفاتورة تحت يد الزبون. متأكد؟
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              className="flex-1"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate({ audience: "CUSTOMER" })}
            >
              نعم، أرسل إلى {customerName || "الزبون"}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setConfirmCustomerOpen(false)}>
              تراجع
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── The freshly minted link ── */}
      <Dialog open={!!created && !channelOpen} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-emerald-600" />
              رابط الجرد جاهز
            </DialogTitle>
          </DialogHeader>
          {created && (
            <div className="space-y-3">
              <p className="text-sm">
                إلى <span className="font-bold">{created.recipientName}</span>
                {created.recipientPhone ? <span className="text-muted-foreground" dir="ltr"> ({created.recipientPhone})</span> : null}
                {" — "}
                صالح حتى{" "}
                <span className="font-semibold">
                  {new Date(created.expiresAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </p>
              <div className="rounded-lg bg-muted p-2 text-xs break-all" dir="ltr">{url}</div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => void copyLink()}>
                  <Copy className="h-4 w-4" /> نسخ الرابط
                </Button>
                <Button
                  className="flex-1"
                  disabled={!created.recipientPhone}
                  onClick={() => setChannelOpen(true)}
                >
                  إرسال بالواتساب
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {created.audience === "WORKER"
                  ? "جرد العامل يُطبَّق على الفاتورة فور إرساله."
                  : "جرد الزبون لا يغيّر الفاتورة حتى توافق عليه أنت."}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <WhatsAppChannelDialog
        open={channelOpen}
        onClose={() => setChannelOpen(false)}
        onSend={(channel) => void sendOnChannel(channel)}
        sending={sending}
        phone={created?.recipientPhone ?? undefined}
        webMessage={message}
        title="إرسال رابط الجرد"
      />
    </>
  )
}

function buildMessage(link: InvoiceCountLink, invoiceNumber: string, url: string) {
  const until = new Date(link.expiresAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
  if (link.audience === "WORKER") {
    return (
      `مرحبا ${link.recipientName}\n` +
      `رجاءً اجرد فاتورة رقم ${invoiceNumber} قبل خروجها من المحل.\n` +
      `افتح الرابط واكتب الكمية الواصلة لكل مادة:\n${url}\n` +
      `الرابط صالح حتى ${until}`
    )
  }
  return (
    `مرحبا ${link.recipientName}\n` +
    `هذا رابط جرد فاتورة رقم ${invoiceNumber}.\n` +
    `افتحه واكتب الكمية التي وصلتك فعلاً لكل مادة — وإذا لم تصلك مادة اكتب صفر:\n${url}\n` +
    `الرابط صالح حتى ${until}`
  )
}
