import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Check, ChevronDown, Copy, Gavel, MessageCircle, Plus, RefreshCw, X } from "lucide-react"
import { cancelAuction, createAuction, getAuctions, getProducts } from "../api/endpoints"
import type { AuctionIncrementType, AuctionLot, AuctionStatus } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { HoverZoomImage } from "../components/HoverZoomImage"
import { QueryErrorBox } from "../components/ui/query-error"
import { toast } from "../components/ui/use-toast"
import { usePageTitle } from "../hooks/usePageTitle"
import { useSettings } from "../hooks/useSettings"
import { useCountdown } from "../hooks/useCountdown"
import { apiErrorMessage } from "../utils/apiError"
import { fmt } from "../utils/fmt"

/** The shop's public origin — the desktop build has no usable window origin. */
export function auctionLinkUrl(token: string, catalogPublicUrl?: string | null) {
  const configured = catalogPublicUrl?.trim().replace(/\/catalog.*$/, "").replace(/\/$/, "")
  return `${configured || window.location.origin}/auction/${token}`
}

const unitLabel = (unit: string) => (unit === "CARTON" ? "كارتون" : "قطعة")

/** Default end: tomorrow at 9 PM local, as a datetime-local value. */
function defaultEnd() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(21, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function CreateAuctionForm({ onCreated }: { onCreated: (lot: AuctionLot) => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [product, setProduct] = useState<{ id: string; name: string; itemNumber: string; currentStock?: number; pcsPerCarton: number; thumbnailUrl?: string | null; mediumUrl?: string | null } | null>(null)
  const [unit, setUnit] = useState<"PIECE" | "CARTON">("CARTON")
  const [quantity, setQuantity] = useState("")
  const [startPrice, setStartPrice] = useState("0")
  const [incrementType, setIncrementType] = useState<AuctionIncrementType>("AMOUNT")
  const [incrementValue, setIncrementValue] = useState("1000")
  const [endsAt, setEndsAt] = useState(defaultEnd)
  const [notes, setNotes] = useState("")

  const results = useQuery({
    queryKey: ["auction-product-search", search],
    queryFn: () => getProducts({ search, limit: 12 }),
    enabled: search.trim().length >= 2 && !product,
    staleTime: 30_000,
  })

  const availableUnits = product
    ? Math.floor((product.currentStock ?? 0) / (unit === "CARTON" ? Math.max(1, product.pcsPerCarton) : 1))
    : 0

  const create = useMutation({
    mutationFn: () =>
      createAuction({
        productId: product!.id,
        unit,
        quantity: Number(quantity),
        startPrice: Number(startPrice),
        incrementType,
        incrementValue: Number(incrementValue),
        endsAt: new Date(endsAt).toISOString(),
        notes: notes.trim() || undefined,
      }),
    onSuccess: (lot) => {
      toast({ title: "انفتح المزاد — انسخ الرابط وأرسله" })
      void qc.invalidateQueries({ queryKey: ["auctions"] })
      setProduct(null)
      setSearch("")
      setQuantity("")
      setNotes("")
      onCreated(lot)
    },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذّر فتح المزاد"), variant: "destructive" }),
  })

  const valid =
    !!product && Number(quantity) > 0 && Number(startPrice) >= 0 && Number(incrementValue) > 0 &&
    (incrementType === "AMOUNT" || Number(incrementValue) <= 100) && !!endsAt && new Date(endsAt).getTime() > Date.now()

  return (
    <div className="space-y-4 rounded-xl border bg-white p-4 dark:bg-slate-950 md:p-5">
      <h2 className="flex items-center gap-2 font-bold"><Plus className="h-4 w-4" /> مزاد جديد</h2>

      {/* Product */}
      {product ? (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-3">
          <HoverZoomImage src={product.thumbnailUrl} largeSrc={product.mediumUrl} alt={product.name} fallback={product.itemNumber} className="h-14 w-14" />
          <div className="min-w-0">
            <p className="font-semibold">{product.name}</p>
            <p className="text-xs text-slate-500">
              {product.itemNumber} · الموجود {fmt(product.currentStock ?? 0)} قطعة
              {product.pcsPerCarton > 1 ? ` (${fmt(Math.floor((product.currentStock ?? 0) / product.pcsPerCarton))} كارتون)` : ""}
            </p>
          </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setProduct(null)}><X className="h-4 w-4" /> تغيير</Button>
        </div>
      ) : (
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن المادة الراكدة"
            className="h-11 w-full rounded-lg border px-3 dark:bg-slate-900"
          />
          {(results.data?.length ?? 0) > 0 && (
            <div className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-white shadow-lg dark:bg-slate-900">
              {results.data!.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProduct({ id: p.id, name: p.name, itemNumber: p.itemNumber, currentStock: p.currentStock, pcsPerCarton: p.pcsPerCarton, thumbnailUrl: p.thumbnailUrl, mediumUrl: p.mediumUrl })}
                  className="flex w-full items-center gap-3 px-3 py-2 text-right text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <HoverZoomImage src={p.thumbnailUrl} largeSrc={p.mediumUrl} alt={p.name} fallback={p.itemNumber} className="h-12 w-12" />
                  <span className="min-w-0 flex-1 font-medium">{p.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{p.itemNumber} · {fmt(p.currentStock ?? 0)} قطعة</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">الوحدة</span>
          <div className="flex gap-1 rounded-lg border p-0.5 dark:border-slate-700">
            {(["CARTON", "PIECE"] as const).map((u) => (
              <button key={u} type="button" onClick={() => setUnit(u)}
                className={`h-9 flex-1 rounded-md text-sm font-medium ${unit === u ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                {unitLabel(u)}
              </button>
            ))}
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">
            الكمية المطروحة ({unitLabel(unit)}){product ? ` — الموجود ${fmt(availableUnits)}` : ""}
          </span>
          <div className="flex gap-1">
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)}
              className="h-11 w-full rounded-lg border px-3 dark:bg-slate-900" />
            {product && availableUnits > 0 && (
              <Button type="button" variant="outline" className="h-11" onClick={() => setQuantity(String(availableUnits))}>الكل</Button>
            )}
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">سعر البداية لل{unitLabel(unit)} (د.ع)</span>
          <input type="number" min={0} value={startPrice} onChange={(e) => setStartPrice(e.target.value)}
            className="h-11 w-full rounded-lg border px-3 dark:bg-slate-900" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">كل مزايدة تزيد</span>
          <div className="flex gap-1">
            <input type="number" min={1} value={incrementValue} onChange={(e) => setIncrementValue(e.target.value)}
              className="h-11 w-full rounded-lg border px-3 dark:bg-slate-900" />
            <div className="flex gap-1 rounded-lg border p-0.5 dark:border-slate-700">
              {([["AMOUNT", "دينار"], ["PERCENT", "٪"]] as const).map(([t, label]) => (
                <button key={t} type="button" onClick={() => setIncrementType(t)}
                  className={`h-9 rounded-md px-3 text-sm font-medium ${incrementType === t ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">ينتهي</span>
          <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)}
            className="h-11 w-full rounded-lg border px-3 dark:bg-slate-900" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">ملاحظة للزبائن (اختياري)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="مثلاً: الاستلام من المحل"
            className="h-11 w-full rounded-lg border px-3 dark:bg-slate-900" />
        </label>
      </div>

      <p className="text-xs text-slate-500">
        السعر لل{unitLabel(unit)} الواحد، والفايز يدفع السعر × الكمية.
        {incrementType === "PERCENT" ? " الزيادة بالنسبة تتقرّب لفوق لأقرب ٢٥٠ دينار." : ""}
        {" "}أول مزايدة = سعر البداية + الزيادة، يعني أول ما يضغط الزبون يرتفع السعر.
        {" "}أي مزايدة بآخر ٥ دقايق تمدد المزاد ساعة كاملة.
      </p>

      <Button onClick={() => create.mutate()} disabled={!valid || create.isPending} className="h-11 px-6">
        <Gavel className="h-4 w-4" /> {create.isPending ? "جاري الفتح..." : "افتح المزاد"}
      </Button>
    </div>
  )
}

function AuctionCard({ lot, publicUrlBase, highlight }: { lot: AuctionLot; publicUrlBase?: string | null; highlight: boolean }) {
  const qc = useQueryClient()
  const [showBids, setShowBids] = useState(highlight)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const active = lot.status === "ACTIVE"
  const { left, label } = useCountdown(lot.endsAt, active)
  const url = auctionLinkUrl(lot.token, publicUrlBase)
  const unit = unitLabel(lot.unit)

  const cancel = useMutation({
    mutationFn: () => cancelAuction(lot.id),
    onSuccess: () => {
      toast({ title: "انلغى المزاد" })
      setConfirmCancel(false)
      void qc.invalidateQueries({ queryKey: ["auctions"] })
    },
    onError: (e) => toast({ title: apiErrorMessage(e, "تعذّر إلغاء المزاد"), variant: "destructive" }),
  })

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: "انسخ الرابط" })
    } catch {
      toast({ title: "ما قدرت أنسخ — انسخ الرابط يدوي", variant: "destructive" })
    }
  }

  const shareText = `مزاد على ${lot.quantity} ${unit} ${lot.product.name} — يبدي من ${fmt(lot.startPrice)} د.ع لل${unit}. زايد من هنا:\n${url}`

  return (
    <div className={`rounded-xl border bg-white p-4 dark:bg-slate-950 ${highlight ? "ring-2 ring-amber-400" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <HoverZoomImage src={lot.product.thumbnailUrl} alt={lot.product.name} fallback={lot.product.itemNumber} className="h-16 w-16" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{lot.product.name}</p>
          <p className="text-xs text-slate-500">
            {fmt(lot.quantity)} {unit} · يبدي {fmt(lot.startPrice)} · الزيادة {lot.incrementType === "PERCENT" ? `${lot.incrementValue}٪` : `${fmt(lot.incrementValue)} د.ع`}
          </p>
          {lot.notes && <p className="text-xs text-slate-400">{lot.notes}</p>}
        </div>
        <div className="text-left">
          {active ? (
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${left <= 5 * 60_000 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
              شغّال · باقي {label}
            </span>
          ) : lot.status === "ENDED" ? (
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white dark:bg-amber-500 dark:text-slate-900">انتهى</span>
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">ملغى</span>
          )}
          <p className="mt-2 text-lg font-extrabold">{lot.currentPrice != null ? `${fmt(lot.currentPrice)} د.ع` : "—"}</p>
          <p className="text-xs text-slate-500">{fmt(lot.bidCount)} مزايدة</p>
        </div>
      </div>

      {lot.status === "ENDED" && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30">
          {lot.winner ? (
            <>
              🏆 الفايز <b>{lot.winner.name}</b> — <a href={`tel:${lot.winner.phone}`} className="font-mono font-bold underline" dir="ltr">{lot.winner.phone}</a>
              <span className="text-slate-600 dark:text-slate-300"> · {fmt(lot.winner.amount)} لل{unit} × {fmt(lot.quantity)} = <b>{fmt(lot.winner.total)} د.ع</b></span>
              <span className="block text-xs text-slate-500">سوّي الفاتورة من الفواتير. لو ما رد، قائمة المزايدين تحت بالترتيب.</span>
            </>
          ) : (
            <>ما زايد أحد.</>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {active && (
          <>
            <Button size="sm" variant="outline" onClick={() => void copy()}><Copy className="h-4 w-4" /> نسخ الرابط</Button>
            <Button size="sm" variant="outline" asChild>
              <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-4 w-4" /> مشاركة بالواتساب
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={url} target="_blank" rel="noreferrer">فتح صفحة المزاد</a>
            </Button>
          </>
        )}
        {lot.bidCount > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setShowBids((v) => !v)}>
            <ChevronDown className={`h-4 w-4 transition ${showBids ? "rotate-180" : ""}`} /> المزايدين ({fmt(lot.bids.length)})
          </Button>
        )}
        {active && (
          <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setConfirmCancel(true)}>
            <X className="h-4 w-4" /> إلغاء المزاد
          </Button>
        )}
      </div>

      {showBids && lot.bids.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-right">#</th>
                <th className="px-3 py-2 text-right">الاسم</th>
                <th className="px-3 py-2 text-right">الهاتف</th>
                <th className="px-3 py-2 text-right">المبلغ لل{unit}</th>
                <th className="px-3 py-2 text-right">الوقت</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-slate-800">
              {lot.bids.map((b, i) => (
                <tr key={b.id} className={i === 0 ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}>
                  <td className="px-3 py-2 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{b.name}</td>
                  <td className="px-3 py-2"><a href={`tel:${b.phone}`} className="font-mono underline" dir="ltr">{b.phone}</a></td>
                  <td className="px-3 py-2 font-bold">{fmt(b.amount)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {new Date(b.createdAt).toLocaleString("en-GB")}
                    {b.extendedEnd && <span className="mr-1 text-amber-600">(+ساعة)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="إلغاء المزاد؟"
        description={lot.bidCount > 0 ? `في ${lot.bidCount} مزايدة عليه. الرابط راح يوقف عن قبول المزايدات.` : "الرابط راح يوقف عن قبول المزايدات."}
        confirmLabel="إلغاء المزاد"
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  )
}

const FILTERS: Array<[AuctionStatus | "", string]> = [["", "الكل"], ["ACTIVE", "الشغّالة"], ["ENDED", "المنتهية"], ["CANCELLED", "الملغاة"]]

export function AuctionsPage() {
  usePageTitle("المزادات")
  const { data: settings } = useSettings()
  const [filter, setFilter] = useState<AuctionStatus | "">("")
  const [showForm, setShowForm] = useState(false)
  const [justCreated, setJustCreated] = useState<string | null>(null)

  const auctions = useQuery({
    queryKey: ["auctions", filter],
    queryFn: () => getAuctions(filter || undefined),
    // Bids arrive from outside; the page keeps itself current.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })

  const counts = useMemo(() => {
    const list = auctions.data ?? []
    return { active: list.filter((a) => a.status === "ACTIVE").length }
  }, [auctions.data])

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Gavel className="h-6 w-6" /> مزاد تصفية الراكد</h1>
          <p className="text-sm text-slate-500">
            افتح مزاد على بضاعة نايمة، أرسل الرابط، والزبائن يزايدون بضغطة. لما يخلص الوقت يطلعلك الفايز ورقمه بالرئيسية.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void auctions.refetch()} disabled={auctions.isFetching}>
            <RefreshCw className={"h-4 w-4 " + (auctions.isFetching ? "animate-spin" : "")} /> تحديث
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {showForm ? "إغلاق" : "مزاد جديد"}
          </Button>
        </div>
      </div>

      {showForm && (
        <CreateAuctionForm onCreated={(lot) => { setShowForm(false); setFilter(""); setJustCreated(lot.id) }} />
      )}

      <div className="flex flex-wrap gap-1 rounded-lg border p-0.5 dark:border-slate-700" style={{ width: "fit-content" }}>
        {FILTERS.map(([id, label]) => (
          <button key={id || "all"} type="button" onClick={() => setFilter(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${filter === id ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900" : "hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
            {label}{id === "ACTIVE" && filter === "" && counts.active > 0 ? ` (${counts.active})` : ""}
          </button>
        ))}
      </div>

      {auctions.isError ? (
        <QueryErrorBox title="تعذّر تحميل المزادات" onRetry={() => void auctions.refetch()} />
      ) : auctions.isPending ? (
        <p className="rounded-xl border bg-white p-10 text-center text-sm text-slate-400 dark:bg-slate-950">جاري التحميل...</p>
      ) : (auctions.data?.length ?? 0) === 0 ? (
        <div className="rounded-xl border bg-white p-10 text-center dark:bg-slate-950">
          <Gavel className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 font-semibold">ما في مزادات{filter ? " بهذا الفلتر" : " بعد"}.</p>
          <p className="mt-1 text-sm text-slate-400">
            تريد تعرف شنو الراكد؟ شوف <Link to="/reports/purchase-performance" className="underline">أداء المشتريات</Link> — فلتر «راكد».
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {auctions.data!.map((lot) => (
            <AuctionCard key={lot.id} lot={lot} publicUrlBase={settings?.catalogPublicUrl} highlight={lot.id === justCreated} />
          ))}
        </div>
      )}

      {justCreated && (
        <p className="flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3 w-3" /> المزاد الجديد مؤشّر بإطار أصفر.</p>
      )}
    </div>
  )
}

export default AuctionsPage
