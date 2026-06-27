import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Inbox, Send, CheckCircle2 } from "lucide-react"
import { getInboundMessages, markInboundMessageRead, replyToInboundMessage } from "../api/endpoints"
import type { InboundMessage, InboundMessageStatus } from "../types/api"

const SOURCE_LABEL: Record<string, string> = {
  CUSTOMER_UNMATCHED: "زبون قديم — سؤال غير معروف",
  PROSPECT: "زبون جديد (محتمل)",
  UNKNOWN: "رقم غير مسجل",
}
const SOURCE_COLOR: Record<string, string> = {
  CUSTOMER_UNMATCHED: "bg-blue-100 text-blue-700",
  PROSPECT: "bg-emerald-100 text-emerald-700",
  UNKNOWN: "bg-gray-100 text-gray-600",
}

export function InboundMessagesPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<InboundMessageStatus | "ALL">("ALL")
  const [openId, setOpenId] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ["inbound-messages", filter],
    queryFn: () => getInboundMessages(filter === "ALL" ? undefined : { status: filter }),
    refetchInterval: 15_000,
  })
  const data = q.data

  const readMut = useMutation({
    mutationFn: (id: string) => markInboundMessageRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inbound-messages"] }),
  })

  function openMessage(m: InboundMessage) {
    setOpenId(m.id)
    if (m.status === "UNREAD") readMut.mutate(m.id)
  }

  return (
    <div dir="rtl" className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold text-gray-900">
          <Inbox className="h-6 w-6 text-emerald-600" /> الرسائل الواردة
          {!!data?.unreadCount && (
            <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{data.unreadCount}</span>
          )}
        </h1>
        <p className="mt-1 text-sm text-gray-500">رسائل من زبائن جدد، أرقام غير مسجلة، أو أسئلة زبائن قدامى خارج الأوامر التلقائية</p>
      </div>

      <div className="mb-4 flex gap-2">
        {(["ALL", "UNREAD", "READ", "REPLIED"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${filter === f ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600"}`}>
            {f === "ALL" ? "الكل" : f === "UNREAD" ? "غير مقروءة" : f === "READ" ? "مقروءة" : "مردود عليها"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {data?.items.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 py-12 text-center text-gray-400">لا توجد رسائل</div>
        )}
        {data?.items.map((m) => (
          <button key={m.id} onClick={() => openMessage(m)}
            className={`block w-full rounded-2xl border p-3 text-right transition ${m.status === "UNREAD" ? "border-emerald-300 bg-emerald-50/40" : "border-gray-200 bg-white"}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {m.status === "UNREAD" && <span className="h-2 w-2 rounded-full bg-rose-500" />}
                <span className="font-bold text-gray-800" dir="ltr">{m.phone}</span>
                {m.name && <span className="text-xs text-gray-400">{m.name}</span>}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SOURCE_COLOR[m.source]}`}>{SOURCE_LABEL[m.source]}</span>
            </div>
            <p className="mt-1.5 truncate text-sm text-gray-600">{m.messageText}</p>
            {m.status === "REPLIED" && (
              <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> تم الرد: {m.replyText}</p>
            )}
          </button>
        ))}
      </div>

      {openId && data && (
        <ReplyModal message={data.items.find((m) => m.id === openId)!} onClose={() => setOpenId(null)}
          onSent={() => { setOpenId(null); qc.invalidateQueries({ queryKey: ["inbound-messages"] }) }} />
      )}
    </div>
  )
}

function ReplyModal({ message, onClose, onSent }: { message: InboundMessage; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState("")
  const mut = useMutation({
    mutationFn: () => replyToInboundMessage(message.id, text),
    onSuccess: onSent,
  })
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-sm text-gray-800" dir="ltr">{message.phone}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SOURCE_COLOR[message.source]}`}>{SOURCE_LABEL[message.source]}</span>
        </div>
        <div className="mb-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-700">{message.messageText}</div>
        <label className="mb-1 block text-xs font-bold text-gray-600">ردّك</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
          placeholder="اكتب الرد هنا..."
          className="mb-3 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-400" />
        {mut.isError && <p className="mb-2 text-xs text-red-600">تعذر إرسال الرد — تأكد من إعدادات واتساب.</p>}
        <div className="flex gap-2">
          <button disabled={!text.trim() || mut.isPending} onClick={() => mut.mutate()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            <Send className="h-4 w-4" /> {mut.isPending ? "..." : "إرسال"}
          </button>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-bold text-gray-600">إغلاق</button>
        </div>
      </div>
    </div>
  )
}

export default InboundMessagesPage
