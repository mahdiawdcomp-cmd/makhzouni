import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { getStorefrontPersonProfile } from "../api/endpoints"
import { cn } from "../utils/cn"

/* ══════════════════════════════════════════════════════════════════════
   One person, everything about them.

   Answering "who is this and what have they done" used to mean walking four
   screens. The server assembles the whole picture in one reply, so this panel
   cannot show a half-loaded version of someone.
══════════════════════════════════════════════════════════════════════ */

const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" }) : "—"

function duration(totalSeconds: number) {
  if (!totalSeconds) return "—"
  const m = Math.round(totalSeconds / 60)
  if (m < 60) return `${m} دقيقة`
  return `${Math.floor(m / 60)} ساعة و${m % 60} دقيقة`
}

export function StorefrontPersonPanel({ phone, onClose }: { phone: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["person-profile", phone],
    queryFn: () => getStorefrontPersonProfile(phone),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      dir="rtl" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}>

        {isLoading && <p className="py-8 text-center text-sm text-slate-400">جاري التحميل...</p>}
        {isError && <p className="py-8 text-center text-sm text-red-600">ما لقينا هذا الرقم</p>}

        {data && (
          <>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-base font-bold text-slate-900">{data.name || "بلا اسم"}</h3>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    data.kind === "CUSTOMER" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600",
                  )}>
                    {data.kind === "CUSTOMER" ? "زبون المحل" : "زائر"}
                  </span>
                </div>
                <p className="text-xs text-slate-400" dir="ltr">{data.phone}</p>
              </div>
              <button onClick={onClose} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Badges: the state the merchant scans for first. */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge on={data.pricesVisible} yes="الأسعار مفتوحة" no="الأسعار مخفية" />
              <Badge on={data.hasCode} yes="عنده رمز" no="بلا رمز" />
              {data.priceRequestPending && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                  ⏳ يطلب عرض أسعار
                </span>
              )}
              {data.locked && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                  مقفل مؤقتاً
                </span>
              )}
              {data.kind === "VISITOR" && !data.detailsSubmitted && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                  ما كمّل بياناته
                </span>
              )}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Row label="العنوان" value={data.address || "—"} />
              <Row label="المحافظة" value={data.province || "—"} />
              {data.balance != null && (
                <Row label="الرصيد" value={`${data.balance.toLocaleString("en-US")} د.ع`} />
              )}
              <Row label="آخر دخول" value={fmtDate(data.lastLoginAt)} />
              <Row label="أول زيارة" value={fmtDate(data.firstSeenAt)} />
              <Row label="آخر زيارة" value={fmtDate(data.lastSeenAt)} />
              <Row label="عدد الزيارات" value={String(data.visits || 0)} />
              <Row label="وقت التصفح" value={duration(data.totalTimeSeconds)} />
              <Row label="مواد شافها" value={String(data.productViews || 0)} />
              <Row label="أُرسل الرمز" value={fmtDate(data.codeSetAt)} />
            </dl>

            {data.notes && (
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{data.notes}</p>
            )}

            {data.orders.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-bold text-slate-600">آخر الفواتير</p>
                <div className="space-y-1">
                  {data.orders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                      <span className="text-slate-600">{o.invoiceNumber}</span>
                      <span className="font-bold text-slate-800">{o.total.toLocaleString("en-US")} د.ع</span>
                      <span className="text-slate-400">{fmtDate(o.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.reservations.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-bold text-slate-600">حجوزاته على البضاعة القادمة</p>
                <div className="space-y-1">
                  {data.reservations.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg bg-sky-50 px-3 py-1.5 text-xs">
                      <span className="truncate text-slate-700">{r.itemName}</span>
                      <span className="shrink-0 font-bold text-slate-800">{r.quantity}</span>
                      <span className="shrink-0 text-slate-500">
                        {r.status === "CONFIRMED" ? "مؤكد" : r.status === "CANCELLED" ? "ملغى" : "معلّق"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
              الأزرار — فتح الأسعار، إرسال الرمز، الحفظ كزبون — على سطر الشخص بالقائمة خلف هذي النافذة.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function Badge({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return (
    <span className={cn(
      "rounded-full px-2 py-0.5 text-[11px] font-bold",
      on ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
    )}>
      {on ? yes : no}
    </span>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="truncate font-semibold text-slate-700">{value}</dd>
    </>
  )
}
