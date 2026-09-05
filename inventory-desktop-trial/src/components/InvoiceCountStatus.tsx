// «جرد الفاتورة» — what happened, on every invoice, forever.
//
// The owner's ask, in his words: open an invoice from a month ago and be told
// whether the worker counted it, whether the customer counted it, whether either
// of them ever opened the link at all, and what came out of it. So this strip
// answers all of that in a sentence per audience, with the line-by-line detail
// one click away.
//
// It also carries the loudest thing in the feature: money the shop is holding
// that belongs to the customer, because a paid invoice shrank after a count.
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock,
  EyeOff, HandCoins, Hourglass, Truck, UserCheck, XCircle,
} from "lucide-react"

import { Button } from "./ui/button"
import { toast } from "./ui/use-toast"
import {
  acknowledgeCountRefund,
  getInvoiceCountLinks,
  type InvoiceCountLink,
} from "../api/endpoints"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"

const fmt = (n: number) => Math.round(n).toLocaleString("en-US")

function when(iso: string | null) {
  if (!iso) return ""
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
}

type Tone = "neutral" | "good" | "warn" | "bad" | "wait"

const TONE_STYLES: Record<Tone, { border: string; text: string }> = {
  neutral: { border: "border-slate-200 dark:border-slate-700", text: "text-muted-foreground" },
  good: { border: "border-emerald-300 dark:border-emerald-800", text: "text-emerald-700 dark:text-emerald-400" },
  warn: { border: "border-amber-300 dark:border-amber-800", text: "text-amber-700 dark:text-amber-400" },
  bad: { border: "border-rose-300 dark:border-rose-800", text: "text-rose-700 dark:text-rose-400" },
  wait: { border: "border-indigo-300 dark:border-indigo-800", text: "text-indigo-700 dark:text-indigo-400" },
}

/** One sentence saying exactly where this link got to. */
function describe(link: InvoiceCountLink): { text: string; tone: Tone; icon: typeof Clock } {
  const differing = link.result?.differenceCount ?? 0

  if (link.status === "SUBMITTED") {
    if (!link.hasDifference) {
      return { text: "جرد الفاتورة وكل شيء مطابق", tone: "good", icon: CheckCircle2 }
    }
    if (link.appliedAt) {
      return {
        text: `جرد الفاتورة وطلع فرق في ${differing} صنف — وتعدّلت الفاتورة`,
        tone: "warn",
        icon: AlertTriangle,
      }
    }
    if (link.approval?.status === "REJECTED") {
      return {
        text: `جرد الفاتورة وطلع فرق في ${differing} صنف — ورفضت التعديل`,
        tone: "bad",
        icon: XCircle,
      }
    }
    return {
      text: `جرد الفاتورة وطلع فرق في ${differing} صنف — بانتظار موافقتك`,
      tone: "wait",
      icon: Hourglass,
    }
  }

  if (link.status === "REVOKED") {
    return { text: "أُلغي هذا الرابط (أُرسل رابط أحدث)", tone: "neutral", icon: XCircle }
  }
  if (link.status === "EXPIRED") {
    return link.viewCount > 0
      ? { text: `فتح الرابط ${link.viewCount} مرة وما خلّص الجرد، وانتهت مدته`, tone: "bad", icon: Clock }
      : { text: "انتهت مدة الرابط وما فتحه أبداً", tone: "bad", icon: EyeOff }
  }
  if (link.viewCount > 0) {
    return {
      text: `فتح الرابط ${link.viewCount} مرة وما خلّص الجرد بعد`,
      tone: "warn",
      icon: Clock,
    }
  }
  return { text: "ما فتح الرابط أبداً", tone: "neutral", icon: EyeOff }
}

export function InvoiceCountStatus({ invoiceId, currency = "د.ع" }: { invoiceId: string; currency?: string }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)

  const linksQ = useQuery({
    queryKey: ["invoice-count-links", invoiceId],
    queryFn: () => getInvoiceCountLinks(invoiceId),
    enabled: !!invoiceId,
  })

  const ackMutation = useMutation({
    mutationFn: (linkId: string) => acknowledgeCountRefund(linkId),
    onSuccess: () => {
      toast({ title: "تم تسجيل إرجاع المبلغ" })
      void queryClient.invalidateQueries({ queryKey: ["invoice-count-links", invoiceId] })
    },
    onError: (error) => {
      toast({ title: "تعذر التسجيل", description: apiErrorMessage(error), variant: "destructive" })
    },
  })

  const links = linksQ.data ?? []
  if (links.length === 0) return null

  // Newest first from the API — the first of each audience is the live story,
  // older ones are history and stay collapsed underneath.
  const worker = links.filter((l) => l.audience === "WORKER")
  const customer = links.filter((l) => l.audience === "CUSTOMER")
  const refunds = links.filter((l) => (l.refundDue ?? 0) > 0)

  return (
    <section className="print:hidden space-y-2">
      {refunds.map((link) => (
        <RefundBanner
          key={link.id}
          link={link}
          currency={currency}
          busy={ackMutation.isPending}
          onAcknowledge={() => ackMutation.mutate(link.id)}
        />
      ))}

      <div className="rounded-xl border bg-card p-3">
        <h3 className="mb-2 text-sm font-bold text-muted-foreground">جرد هذه الفاتورة</h3>
        <div className="space-y-2">
          <AudienceBlock
            title="العامل"
            icon={Truck}
            links={worker}
            expanded={expanded}
            onToggle={setExpanded}
          />
          <AudienceBlock
            title="الزبون"
            icon={UserCheck}
            links={customer}
            expanded={expanded}
            onToggle={setExpanded}
          />
        </div>
      </div>
    </section>
  )
}

function AudienceBlock({
  title, icon: Icon, links, expanded, onToggle,
}: {
  title: string
  icon: typeof Truck
  links: InvoiceCountLink[]
  expanded: string | null
  onToggle: (id: string | null) => void
}) {
  if (links.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-sm text-muted-foreground dark:border-slate-700">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="font-semibold">{title}:</span>
        <span>ما أُرسل له رابط جرد</span>
      </div>
    )
  }

  const [latest, ...older] = links
  return (
    <div className="space-y-1.5">
      <LinkRow title={title} icon={Icon} link={latest} expanded={expanded} onToggle={onToggle} />
      {older.length > 0 && (
        <details className="pr-6">
          <summary className="cursor-pointer text-xs text-muted-foreground">
            روابط أقدم ({older.length})
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {older.map((link) => (
              <LinkRow key={link.id} title={title} icon={Icon} link={link} expanded={expanded} onToggle={onToggle} muted />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function LinkRow({
  title, icon: Icon, link, expanded, onToggle, muted,
}: {
  title: string
  icon: typeof Truck
  link: InvoiceCountLink
  expanded: string | null
  onToggle: (id: string | null) => void
  muted?: boolean
}) {
  const state = describe(link)
  const StateIcon = state.icon
  const tone = TONE_STYLES[state.tone]
  const isOpen = expanded === link.id
  const hasDetail = !!link.result?.lines?.length

  return (
    <div className={cn("rounded-lg border px-3 py-2", tone.border, muted && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-bold">{title} — {link.recipientName}</span>
            <span className="text-xs text-muted-foreground"> · أُرسل {when(link.createdAt)}</span>
          </p>
          <p className={cn("mt-0.5 flex items-center gap-1.5 text-sm font-semibold", tone.text)}>
            <StateIcon className="h-3.5 w-3.5 shrink-0" />
            {state.text}
          </p>
        </div>
        {hasDetail && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onToggle(isOpen ? null : link.id)}>
            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            التفصيل
          </Button>
        )}
      </div>

      {isOpen && hasDetail && <CountDetail link={link} />}
    </div>
  )
}

function CountDetail({ link }: { link: InvoiceCountLink }) {
  const lines = link.result?.lines ?? []
  return (
    <div className="mt-2 overflow-x-auto">
      <p className="mb-1.5 text-xs text-muted-foreground">
        جُرد في {when(link.result?.countedAt ?? link.submittedAt)}
      </p>
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="p-1.5 text-right">الصنف</th>
            <th className="p-1.5 text-center">رقم الايتم</th>
            <th className="p-1.5 text-center">أُرسل</th>
            <th className="p-1.5 text-center">وصل</th>
            <th className="p-1.5 text-center">الفرق</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const diff = line.differencePieces
            return (
              <tr key={line.itemId} className={cn("border-b border-dashed", diff !== 0 && "bg-amber-50/60 dark:bg-amber-950/20")}>
                <td className="p-1.5 text-right">{line.productName}</td>
                <td className="p-1.5 text-center text-xs text-indigo-600 dark:text-indigo-400">{line.itemNumber ?? "—"}</td>
                <td className="p-1.5 text-center tabular-nums">{fmt(line.expectedPieces)}</td>
                <td className="p-1.5 text-center font-bold tabular-nums">{fmt(line.receivedPieces)}</td>
                <td className={cn("p-1.5 text-center font-bold tabular-nums", diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-emerald-600" : "text-rose-600")}>
                  {diff === 0 ? "—" : diff > 0 ? `+${fmt(diff)}` : `−${fmt(-diff)}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted-foreground">الأعداد بالقطعة.</p>
    </div>
  )
}

/**
 * The shop is holding money that belongs to the customer. It stays red on the
 * invoice until someone says the cash was handed back — no screen, no ledger,
 * just a reminder that will not go away on its own.
 */
function RefundBanner({
  link, currency, busy, onAcknowledge,
}: {
  link: InvoiceCountLink
  currency: string
  busy: boolean
  onAcknowledge: () => void
}) {
  const amount = fmt(link.refundDue ?? 0)
  const done = !!link.refundAckAt

  if (done) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-muted/50 px-3 py-2 text-sm text-muted-foreground dark:border-slate-700">
        <HandCoins className="h-4 w-4 shrink-0" />
        <span>
          أُرجع للزبون <span className="font-bold">{amount} {currency}</span> نقداً
          {link.refundAcknowledger?.name ? ` — بواسطة ${link.refundAcknowledger.name}` : ""}
          {` · ${when(link.refundAckAt)}`}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-rose-400 bg-rose-50 px-4 py-3 dark:border-rose-700 dark:bg-rose-950/30">
      <HandCoins className="h-6 w-6 shrink-0 text-rose-600 dark:text-rose-400" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-extrabold text-rose-700 dark:text-rose-300">
          لازم ترجع {amount} {currency} للزبون
        </p>
        <p className="text-sm text-rose-700/80 dark:text-rose-300/80">
          الفاتورة كانت مدفوعة ونزل مجموعها بعد الجرد — هذه فلوس الزبون عندك.
        </p>
      </div>
      <Button
        variant="outline"
        className="border-rose-400 bg-white text-rose-700 hover:bg-rose-100 dark:bg-transparent dark:text-rose-300"
        disabled={busy}
        onClick={onAcknowledge}
      >
        رجّعتها
      </Button>
    </div>
  )
}
