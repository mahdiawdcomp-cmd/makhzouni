import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Building2, Globe, Loader2, MessageCircle, User } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import { toast } from "./ui/use-toast"
import { getWhatsAppStatus, type WhatsAppSendChannel } from "../api/endpoints"
import { openWhatsApp } from "../utils/whatsapp"

// Picked channel as the page sees it — "web" is handled here (opens wa.me),
// so onSend only ever receives official/personal.
export type PickedChannel = WhatsAppSendChannel

const LAST_CHANNEL_KEY = "wa_last_send_channel"

function readLastChannel(): string {
  try { return localStorage.getItem(LAST_CHANNEL_KEY) ?? "official" } catch { return "official" }
}

function saveLastChannel(c: string) {
  try { localStorage.setItem(LAST_CHANNEL_KEY, c) } catch { /* ignore */ }
}

/**
 * Per-send WhatsApp channel picker — replaces direct sends behind every
 * WhatsApp button. Three parallel channels:
 *   official → Meta Cloud API (shop number) — server-side send
 *   personal → Green API (owner's personal number, daily-limited) — server-side
 *   web      → opens wa.me in the browser with a prefilled message; the
 *              employee presses send themselves. Needs `phone` + `webMessage`.
 * Channels that are unconfigured/disabled in Settings are hidden. The last
 * pick is remembered per browser.
 */
export function WhatsAppChannelDialog({
  open,
  onClose,
  onSend,
  sending,
  phone,
  webMessage,
  title,
}: {
  open: boolean
  onClose: () => void
  /** Server-side send through the chosen channel. */
  onSend: (channel: PickedChannel) => void
  sending?: boolean
  /** Needed for the "فتح بواتساب ويب" option; option hidden when missing. */
  phone?: string | null
  webMessage?: string
  title?: string
}) {
  const statusQuery = useQuery({ queryKey: ["whatsapp-status"], queryFn: getWhatsAppStatus, enabled: open, staleTime: 30_000 })
  const channels = statusQuery.data?.channels
  const [selected, setSelected] = useState<string>(readLastChannel())

  const officialAvailable = channels ? channels.official.configured : true
  const personalAvailable = channels ? channels.personal.enabled && channels.personal.configured : false
  const webAvailable = (channels ? channels.web.enabled : true) && Boolean(phone?.trim())

  const options: Array<{ id: string; title: string; desc: string; icon: React.ReactNode }> = []
  if (officialAvailable) {
    options.push({
      id: "official",
      title: "رقم المحل الرسمي",
      desc: "Meta Cloud API — للزبائن الجدد والقوالب الرسمية.",
      icon: <Building2 className="h-5 w-5 text-emerald-600" />,
    })
  }
  if (personalAvailable) {
    const p = channels?.personal
    const usage = p && p.dailyLimit > 0 ? ` (${p.sentToday}/${p.dailyLimit} اليوم)` : ""
    options.push({
      id: "personal",
      title: "الرقم الشخصي",
      desc: `للزبائن الخازنين رقمك — بدون قوالب${usage}.`,
      icon: <User className="h-5 w-5 text-indigo-600" />,
    })
  }
  if (webAvailable) {
    options.push({
      id: "web",
      title: "فتح بواتساب ويب",
      desc: "تنفتح المحادثة برسالة جاهزة وترسلها بنفسك.",
      icon: <Globe className="h-5 w-5 text-sky-600" />,
    })
  }

  // Keep the remembered pick valid against what's actually available.
  useEffect(() => {
    if (!open || options.length === 0) return
    if (!options.some((o) => o.id === selected)) setSelected(options[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, officialAvailable, personalAvailable, webAvailable])

  function confirm() {
    saveLastChannel(selected)
    if (selected === "web") {
      if (!phone?.trim()) {
        toast({ title: "رقم الهاتف غير متوفر", variant: "destructive" })
        return
      }
      openWhatsApp(phone, webMessage ?? "")
      onClose()
      return
    }
    onSend(selected as PickedChannel)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onClose() }}>
      <DialogContent className="max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MessageCircle className="h-5 w-5 text-emerald-600" />
            {title ?? "إرسال عبر واتساب"}
          </DialogTitle>
        </DialogHeader>

        {statusQuery.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : options.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            لا توجد قناة واتساب متاحة — فعّل قناة من <strong>الإعدادات ← واتساب</strong>.
          </p>
        ) : (
          <div className="space-y-2 py-2">
            {options.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelected(o.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-right text-sm transition ${
                  selected === o.id
                    ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200 dark:border-emerald-600 dark:bg-emerald-950/40 dark:ring-emerald-900"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                }`}
              >
                {o.icon}
                <span className="flex-1">
                  <span className="block font-semibold">{o.title}</span>
                  <span className="block text-xs text-slate-500">{o.desc}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-center gap-3 pt-2">
          <Button disabled={sending || options.length === 0} onClick={confirm}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {sending ? "جاري الإرسال..." : selected === "web" ? "فتح المحادثة" : "إرسال"}
          </Button>
          <Button variant="outline" disabled={sending} onClick={onClose}>إلغاء</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
