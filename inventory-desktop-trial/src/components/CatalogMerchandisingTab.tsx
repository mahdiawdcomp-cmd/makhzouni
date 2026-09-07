import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Image as ImageIcon, Search, Sparkles, Tag, Trash2 } from "lucide-react"
import {
  listMerchandisedProducts,
  setProductMerchandising,
  getProducts,
  type MerchandisedProduct,
} from "../api/endpoints"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { Button } from "./ui/button"
import { toast } from "./ui/use-toast"
import { ConfirmDialog } from "./ui/confirm-dialog"
import { cn } from "../utils/cn"

/* ══════════════════════════════════════════════════════════════════════
   «العروض» و«وصل حديثاً»

   Both rows are the shop's own picks, and until now the picking happened one
   product form at a time — so "what is in my offers row" was a question
   nobody could answer without opening every product. This is the row itself:
   what is in it, what comes out, and the two fields that only mean anything
   while a product is in it.
══════════════════════════════════════════════════════════════════════ */

/** <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm"; the API sends UTC. */
function toLocalInput(iso: string | null) {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const p2 = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`
}

const iqd = (n: number | null | undefined) =>
  n == null ? "—" : `${Number(n).toLocaleString("en-US")} د.ع`

export function CatalogMerchandisingTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [confirmRemove, setConfirmRemove] = useState<{ product: MerchandisedProduct; row: "offer" | "new" } | null>(null)

  const listQuery = useQuery({
    queryKey: ["catalog-merchandising"],
    queryFn: listMerchandisedProducts,
  })
  const all = useMemo(() => listQuery.data ?? [], [listQuery.data])
  const offers = useMemo(() => all.filter((p) => p.isOffer), [all])
  const newArrivals = useMemo(() => all.filter((p) => p.isNewArrival), [all])

  const refresh = () => qc.invalidateQueries({ queryKey: ["catalog-merchandising"] })

  const saveMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof setProductMerchandising>[1] }) =>
      setProductMerchandising(id, patch),
    onSuccess: () => { void refresh() },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر الحفظ", variant: "destructive" }),
  })

  // Search the whole catalog, but only to ADD — the rows above are the record
  // of what is in, so a product already in a row is shown as such instead of
  // offering a button that does nothing.
  const searchQuery = useQuery({
    queryKey: ["merch-product-search", search],
    queryFn: () => getProducts({ search: search.trim(), limit: 15 }),
    enabled: search.trim().length >= 2,
  })
  const results = searchQuery.data ?? []

  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardContent className="py-3 text-xs leading-relaxed text-slate-500">
          هذني الصفّين الي يشوفهم الزبون فوق قائمة المنتجات. لإخفاء الصف كله من الكتلوك،
          روح لـ «الواجهة ← الترتيب والنصوص» وأطفيه من هناك — ومن نفس المكان تغيّر عنوانه وترتيبه.
        </CardContent>
      </Card>

      <RowCard
        title="العروض"
        icon={<Tag className="h-5 w-5 text-rose-600" />}
        empty="ما اكو ولا مادة معلّمة كعرض. دوّر عليها تحت وأضفها."
        products={offers}
        loading={listQuery.isLoading}
        renderExtra={(p) => (
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-slate-500">السعر قبل العرض (ينشطب للزبون)</span>
              <Input
                type="number"
                defaultValue={p.oldPrice ?? ""}
                placeholder={`أعلى من ${iqd(p.salePrice)}`}
                dir="ltr"
                className="h-9 text-sm"
                onBlur={(e) => {
                  const raw = e.target.value.trim()
                  const next = raw === "" ? null : Number(raw)
                  if (next === (p.oldPrice ?? null)) return
                  if (next != null && !Number.isFinite(next)) return
                  saveMut.mutate({ id: p.id, patch: { oldPrice: next } })
                }}
              />
              {p.oldPrice != null && p.oldPrice <= p.salePrice && (
                <span className="block text-[11px] font-bold text-amber-600">
                  السعر القديم لازم يكون أعلى من {iqd(p.salePrice)}، وإلا الشطب يخلي العرض يبين أغلى.
                </span>
              )}
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-semibold text-slate-500">ينتهي العرض (اختياري)</span>
              <Input
                type="datetime-local"
                defaultValue={toLocalInput(p.offerEndsAt)}
                dir="ltr"
                className="h-9 text-sm"
                onBlur={(e) => {
                  const raw = e.target.value
                  if (raw === toLocalInput(p.offerEndsAt)) return
                  saveMut.mutate({ id: p.id, patch: { offerEndsAt: raw ? new Date(raw).toISOString() : null } })
                }}
              />
            </label>
          </div>
        )}
        onRemove={(p) => setConfirmRemove({ product: p, row: "offer" })}
      />

      <RowCard
        title="وصل حديثاً"
        icon={<Sparkles className="h-5 w-5 text-indigo-600" />}
        empty="ما اكو ولا مادة معلّمة كجديدة."
        products={newArrivals}
        loading={listQuery.isLoading}
        onRemove={(p) => setConfirmRemove({ product: p, row: "new" })}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-5 w-5 text-slate-500" />
            أضف مادة لأي صف
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="اكتب اسم المادة أو رقمها..."
            className="text-sm"
          />
          {search.trim().length >= 2 && searchQuery.isLoading && (
            <p className="text-xs text-slate-400">جاري البحث...</p>
          )}
          {search.trim().length >= 2 && !searchQuery.isLoading && results.length === 0 && (
            <p className="text-xs text-slate-400">ما لقينا ولا مادة بهذا الاسم.</p>
          )}
          <div className="space-y-2">
            {results.map((p) => {
              const current = all.find((m) => m.id === p.id)
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2.5">
                  <Thumb src={p.thumbnailUrl ?? p.imageUrl ?? null} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{p.name}</p>
                    <p className="text-[11px] text-slate-400">{p.itemNumber} · {iqd(Number(p.salePrice))}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={current?.isOffer ? "secondary" : "outline"}
                    disabled={saveMut.isPending}
                    onClick={() => saveMut.mutate({ id: p.id, patch: { isOffer: !current?.isOffer } })}
                  >
                    {current?.isOffer ? "بالعروض ✓" : "للعروض"}
                  </Button>
                  <Button
                    size="sm"
                    variant={current?.isNewArrival ? "secondary" : "outline"}
                    disabled={saveMut.isPending}
                    onClick={() => saveMut.mutate({ id: p.id, patch: { isNewArrival: !current?.isNewArrival } })}
                  >
                    {current?.isNewArrival ? "بالجديد ✓" : "للجديد"}
                  </Button>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmRemove !== null}
        title={confirmRemove?.row === "offer" ? "شيل من العروض" : "شيل من وصل حديثاً"}
        description={
          confirmRemove?.row === "offer"
            ? `«${confirmRemove?.product.name}» تنشال من صف العروض، ويتمسح سعرها القديم وموعد انتهاء عرضها. المادة نفسها وسعرها ما يتأثرون.`
            : `«${confirmRemove?.product.name ?? ""}» تنشال من صف «وصل حديثاً». المادة نفسها ما تتأثر.`
        }
        confirmLabel="شيلها"
        loading={saveMut.isPending}
        onConfirm={() => {
          const c = confirmRemove
          setConfirmRemove(null)
          if (!c) return
          saveMut.mutate({
            id: c.product.id,
            patch: c.row === "offer" ? { isOffer: false } : { isNewArrival: false },
          })
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  )
}

function RowCard({ title, icon, empty, products, loading, renderExtra, onRemove }: {
  title: string
  icon: React.ReactNode
  empty: string
  products: MerchandisedProduct[]
  loading: boolean
  renderExtra?: (p: MerchandisedProduct) => React.ReactNode
  onRemove: (p: MerchandisedProduct) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
            {products.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-xs text-slate-400">جاري التحميل...</p>}
        {!loading && products.length === 0 && <p className="text-xs text-slate-400">{empty}</p>}
        {products.map((p) => (
          <div key={p.id} className={cn("rounded-xl border border-slate-200 p-3")}>
            <div className="flex items-center gap-3">
              <Thumb src={p.thumbnailUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800">{p.name}</p>
                <p className="text-[11px] text-slate-400">{p.itemNumber} · {iqd(p.salePrice)}</p>
              </div>
              <button onClick={() => onRemove(p)}
                className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                title="شيلها من الصف">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {renderExtra?.(p)}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function Thumb({ src }: { src: string | null }) {
  if (!src) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100">
        <ImageIcon className="h-5 w-5 text-slate-300" />
      </div>
    )
  }
  return <img src={src} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
}
