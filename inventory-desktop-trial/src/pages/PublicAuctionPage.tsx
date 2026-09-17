import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { Gavel, Trophy } from "lucide-react"
import { getPublicAuction, placeAuctionBid } from "../api/endpoints"
import type { PublicAuction } from "../api/endpoints"
import { apiErrorMessage } from "../utils/apiError"
import { fmt } from "../utils/fmt"
import { useCountdown } from "../hooks/useCountdown"

const NAME_KEY = "auction_bidder_name"
const PHONE_KEY = "auction_bidder_phone"

function readStored(key: string) {
  try { return localStorage.getItem(key) ?? "" } catch { return "" }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private mode — just ask again next time */ }
}

const phoneOk = (value: string) => /^(?:\+?964|0)?7\d{9}$/.test(value.replace(/[\s-]/g, ""))

/**
 * «مزاد» — the page a customer opens from the shared link. No login: a name and
 * a phone, then one button that always bids the next step the server allows.
 */
export function PublicAuctionPage() {
  const { token = "" } = useParams()
  const qc = useQueryClient()
  const [name, setName] = useState(() => readStored(NAME_KEY))
  const [phone, setPhone] = useState(() => readStored(PHONE_KEY))
  const [editing, setEditing] = useState(() => !readStored(NAME_KEY) || !readStored(PHONE_KEY))
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null)

  const identified = !editing && name.trim().length >= 2 && phoneOk(phone)
  const key = ["public-auction", token, identified ? phone : ""]

  const auction = useQuery({
    queryKey: key,
    queryFn: () => getPublicAuction(token, identified ? phone : undefined),
    // Other people are bidding: keep up, fast while the clock is short.
    refetchInterval: (query) => {
      const data = query.state.data as PublicAuction | undefined
      if (!data || data.status !== "ACTIVE") return false
      return new Date(data.endsAt).getTime() - Date.now() < 10 * 60_000 ? 2_000 : 5_000
    },
    refetchOnWindowFocus: true,
    retry: 1,
  })

  const data = auction.data
  // Trust the server's clock for the countdown, not the phone's.
  const offset = useMemo(() => (data ? new Date(data.serverNow).getTime() - Date.now() : 0), [data])
  const { left, label } = useCountdown(data?.endsAt ?? null, data?.status === "ACTIVE", offset)

  const bid = useMutation({
    mutationFn: (expectedAmount: number) => placeAuctionBid(token, { name: name.trim(), phone, expectedAmount }),
    onSuccess: (fresh) => {
      qc.setQueryData(key, fresh)
      setNotice({ tone: "ok", text: "✓ مزايدتك الأعلى الحين" })
    },
    onError: (e) => {
      setNotice({ tone: "warn", text: apiErrorMessage(e, "ما انحسبت المزايدة، جرّب مرة ثانية") })
      void auction.refetch()
    },
  })

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  function saveIdentity() {
    if (name.trim().length < 2 || !phoneOk(phone)) return
    store(NAME_KEY, name.trim())
    store(PHONE_KEY, phone.trim())
    setEditing(false)
  }

  if (auction.isPending) {
    return <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-400" dir="rtl">جاري التحميل...</div>
  }
  if (auction.isError || !data) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center" dir="rtl">
        <div>
          <Gavel className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-3 font-bold">الرابط غير صحيح أو المزاد غير موجود.</p>
        </div>
      </div>
    )
  }

  const unit = data.unit === "CARTON" ? "كارتون" : "قطعة"
  const ended = data.status !== "ACTIVE" || left <= 0
  const lastMinutes = !ended && left <= 5 * 60_000

  return (
    <div className="min-h-screen bg-slate-50 pb-10 dark:bg-slate-950" dir="rtl">
      <div className="mx-auto max-w-lg space-y-4 p-4">
        <div className="flex items-center gap-2 pt-2 text-lg font-extrabold">
          <Gavel className="h-6 w-6 text-amber-500" /> مزاد
        </div>

        {/* The lot */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-slate-900">
          {data.product.thumbnailUrl && (
            <img src={data.product.thumbnailUrl} alt={data.product.name} className="aspect-square w-full object-contain bg-white" />
          )}
          <div className="space-y-1 p-4">
            <h1 className="text-xl font-bold">{data.product.name}</h1>
            <p className="text-sm text-slate-500">
              الكمية: <b className="text-slate-900 dark:text-white">{fmt(data.quantity)} {unit}</b>
              {data.unit === "CARTON" && data.product.pcsPerCarton > 1 ? ` (${fmt(data.product.pcsPerCarton)} قطعة بالكارتون)` : ""}
            </p>
            {data.notes && <p className="text-sm text-slate-500">{data.notes}</p>}
          </div>
        </div>

        {/* Price + clock */}
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm dark:bg-slate-900">
          <p className="text-xs text-slate-500">{data.currentPrice != null ? "أعلى سعر لل" + unit : "سعر البداية لل" + unit}</p>
          <p className="text-4xl font-extrabold tracking-tight">{fmt(data.currentPrice ?? data.startPrice)} <span className="text-lg">د.ع</span></p>
          <p className="mt-1 text-xs text-slate-500">
            المجموع {fmt((data.currentPrice ?? data.startPrice) * data.quantity)} د.ع · {fmt(data.bidCount)} مزايدة
          </p>
          <div className={`mt-3 rounded-xl py-2 text-sm font-bold ${ended ? "bg-slate-100 text-slate-500 dark:bg-slate-800" : lastMinutes ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {ended
              ? data.status === "CANCELLED" ? "انلغى المزاد" : "انتهى المزاد"
              : `باقي ${label}`}
          </div>
          {lastMinutes && (
            <p className="mt-1 text-xs text-rose-600">أي مزايدة الحين تمدد المزاد ساعة كاملة.</p>
          )}
        </div>

        {/* Result for this visitor */}
        {data.status === "ENDED" && data.won && (
          <div className="rounded-2xl bg-amber-100 p-4 text-center font-bold text-amber-900">
            <Trophy className="mx-auto mb-1 h-8 w-8" /> مبروك! فزت بالمزاد — المحل راح يتواصل وياك.
          </div>
        )}

        {/* Bidding */}
        {!ended && (
          <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            {editing || !identified ? (
              <>
                <p className="text-sm font-semibold">حتى تزايد، اكتب اسمك ورقمك:</p>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم" maxLength={60}
                  className="h-12 w-full rounded-xl border px-3 text-base dark:bg-slate-800" />
                <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxxx" inputMode="tel" dir="ltr"
                  className="h-12 w-full rounded-xl border px-3 text-left text-base dark:bg-slate-800" />
                {phone && !phoneOk(phone) && <p className="text-xs text-rose-600">رقم عراقي يبدأ بـ 07 ومن 11 رقم.</p>}
                <button type="button" onClick={saveIdentity} disabled={name.trim().length < 2 || !phoneOk(phone)}
                  className="h-12 w-full rounded-xl bg-slate-900 font-bold text-white disabled:opacity-40 dark:bg-amber-500 dark:text-slate-900">
                  متابعة
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-500">
                  تزايد باسم <b>{name}</b> ·{" "}
                  <button type="button" className="underline" onClick={() => setEditing(true)}>تغيير</button>
                </p>
                {data.leading ? (
                  <div className="rounded-xl bg-emerald-50 py-4 text-center font-bold text-emerald-700">
                    ✓ أنت صاحب أعلى مزايدة
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => bid.mutate(data.nextBid)}
                    disabled={bid.isPending}
                    className="h-16 w-full rounded-xl bg-amber-500 text-xl font-extrabold text-slate-900 shadow-lg active:scale-[0.98] disabled:opacity-50"
                  >
                    {bid.isPending ? "..." : `زايد ${fmt(data.nextBid)} د.ع`}
                  </button>
                )}
              </>
            )}
            {notice && (
              <p className={`text-center text-sm font-semibold ${notice.tone === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{notice.text}</p>
            )}
          </div>
        )}

        {/* History */}
        {data.bids.length > 0 && (
          <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-slate-900">
            <p className="mb-2 text-sm font-bold">المزايدات</p>
            <ul className="divide-y text-sm dark:divide-slate-800">
              {data.bids.map((b, i) => (
                <li key={`${b.createdAt}-${i}`} className={`flex items-center justify-between py-2 ${b.mine ? "font-bold text-emerald-700" : ""}`}>
                  <span>
                    {i === 0 ? "🥇 " : ""}{b.name}{b.mine ? " (أنت)" : ""}
                    <span className="mr-2 font-mono text-xs text-slate-400" dir="ltr">{b.phone}</span>
                  </span>
                  <span>{fmt(b.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default PublicAuctionPage
