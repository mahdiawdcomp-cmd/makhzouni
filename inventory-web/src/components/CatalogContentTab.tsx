import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ImageIcon, Plus, Search, Star, Trash2, Upload, X } from "lucide-react"
import {
  addProductCatalogImage,
  deleteCatalogReview,
  deleteProductCatalogImage,
  getProductCatalogContent,
  getProducts,
  listCatalogReviews,
  setCatalogReviewStatus,
  updateProductCatalogContent,
  type AdminCatalogReview,
  type CatalogProductSpec,
} from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { cn } from "../utils/cn"

/* Gallery images are stored as data URIs in the DB (same as the product's own
   image), so downscale before upload — a raw phone photo is several MB and
   every one of them lands in the backups too. */
const MAX_EDGE = 1400
const THUMB_EDGE = 320

function drawScaled(img: HTMLImageElement, maxEdge: number, quality: number): string {
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", quality)
}

async function fileToImagePair(file: File): Promise<{ url: string; thumbnailUrl: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("read failed"))
    reader.readAsDataURL(file)
  })
  const img = new Image()
  img.src = dataUrl
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error("decode failed"))
  })
  return {
    url: drawScaled(img, MAX_EDGE, 0.82),
    thumbnailUrl: drawScaled(img, THUMB_EDGE, 0.72),
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Per-product storefront content
══════════════════════════════════════════════════════════════════════ */
function ProductContentEditor({ productId }: { productId: string }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [description, setDescription] = useState<string | null>(null)
  const [specs, setSpecs] = useState<CatalogProductSpec[] | null>(null)

  const contentQuery = useQuery({
    queryKey: ["product-catalog-content", productId],
    queryFn: () => getProductCatalogContent(productId),
  })
  const content = contentQuery.data

  // null = "not edited yet", so a background refetch never clobbers typing.
  const desc = description ?? content?.description ?? ""
  const rows = specs ?? content?.specs ?? []

  const saveMut = useMutation({
    mutationFn: () => updateProductCatalogContent(productId, {
      description: desc,
      specs: rows.filter((r) => r.label.trim() && r.value.trim()),
    }),
    onSuccess: () => {
      toast({ title: "تم حفظ محتوى المنتج" })
      setDescription(null); setSpecs(null)
      void qc.invalidateQueries({ queryKey: ["product-catalog-content", productId] })
    },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  const deleteImageMut = useMutation({
    mutationFn: (imageId: string) => deleteProductCatalogImage(productId, imageId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["product-catalog-content", productId] }),
    onError: () => toast({ title: "تعذر حذف الصورة", variant: "destructive" }),
  })

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const pair = await fileToImagePair(file)
        await addProductCatalogImage(productId, pair)
      }
      await qc.invalidateQueries({ queryKey: ["product-catalog-content", productId] })
      toast({ title: "تمت إضافة الصور" })
    } catch {
      toast({ title: "تعذر رفع الصور (الحد الأقصى 8 صور للمنتج)", variant: "destructive" })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  if (contentQuery.isLoading) {
    return <p className="py-8 text-center text-sm text-slate-400">جاري التحميل...</p>
  }
  if (!content) {
    return <p className="py-8 text-center text-sm text-slate-400">تعذر تحميل المنتج</p>
  }

  return (
    <div className="space-y-4">
      {/* Description */}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-slate-600">وصف المنتج (يظهر بصفحة المنتج بالكتلوك)</span>
        <textarea
          value={desc}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="اكتب وصف يشرح المنتج للزبون — الاستخدام، الجودة، المميزات..."
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
        />
      </label>

      {/* Specs */}
      <div className="space-y-2 rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700">المواصفات</p>
          <button
            onClick={() => setSpecs([...rows, { label: "", value: "" }])}
            className="flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-100"
          >
            <Plus className="h-3.5 w-3.5" /> إضافة صف
          </button>
        </div>
        {rows.length === 0 && <p className="text-xs text-slate-400">ما في مواصفات — اضغط «إضافة صف»</p>}
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={row.label}
              onChange={(e) => setSpecs(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
              placeholder="الاسم (مثال: الحجم)"
              className="flex-1 text-sm"
            />
            <Input
              value={row.value}
              onChange={(e) => setSpecs(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
              placeholder="القيمة (مثال: 200 قطعة)"
              className="flex-1 text-sm"
            />
            <button
              onClick={() => setSpecs(rows.filter((_, j) => j !== i))}
              className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Gallery */}
      <div className="space-y-3 rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-700">صور إضافية ({content.gallery.length}/8)</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading || content.gallery.length >= 8}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "جاري الرفع..." : "رفع صور"}
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          الصور تُصغّر تلقائياً قبل الحفظ. الصورة الرئيسية للمنتج تظهر أولاً بالمعرض ولا تحتاج رفعها هنا.
        </p>
        {content.gallery.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {content.gallery.map((img) => (
              <div key={img.id} className="group relative h-20 w-20 overflow-hidden rounded-xl border bg-slate-100">
                {img.thumbnailUrl
                  ? <img src={img.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center"><ImageIcon className="h-5 w-5 text-slate-300" /></div>}
                <button
                  onClick={() => deleteImageMut.mutate(img.id)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="px-8">
          {saveMut.isPending ? "جاري الحفظ..." : "حفظ محتوى المنتج"}
        </Button>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   Review moderation
══════════════════════════════════════════════════════════════════════ */
const REVIEW_STATUS_LABEL: Record<AdminCatalogReview["status"], string> = {
  PENDING: "بانتظار المراجعة",
  APPROVED: "منشور",
  REJECTED: "مرفوض",
}

function ReviewsSection() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING")

  const reviewsQuery = useQuery({
    queryKey: ["catalog-reviews", status],
    queryFn: () => listCatalogReviews(status),
  })
  const reviews = reviewsQuery.data ?? []

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["catalog-reviews"] })
  }
  const setStatusMut = useMutation({
    mutationFn: ({ id, next }: { id: string; next: "APPROVED" | "REJECTED" }) =>
      setCatalogReviewStatus(id, next),
    onSuccess: invalidate,
    onError: () => toast({ title: "تعذر تحديث التقييم", variant: "destructive" }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCatalogReview(id),
    onSuccess: invalidate,
    onError: () => toast({ title: "تعذر حذف التقييم", variant: "destructive" }),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Star className="h-5 w-5 text-amber-500" />
          تقييمات الزبائن
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ما يظهر أي تقييم للزبائن قبل ما توافق عليه. إذا الزبون عدّل تقييمه، يرجع لبانتظار المراجعة من جديد.
        </p>

        <div className="flex gap-1.5">
          {(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                status === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              {REVIEW_STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {reviewsQuery.isLoading && <p className="py-6 text-center text-sm text-slate-400">جاري التحميل...</p>}
        {!reviewsQuery.isLoading && reviews.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">ما في تقييمات بهذه الحالة</p>
        )}

        <div className="space-y-2">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-xl border bg-slate-50 p-3">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border bg-white">
                  {r.product.thumbnailUrl
                    ? <img src={r.product.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center"><ImageIcon className="h-4 w-4 text-slate-300" /></div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{r.product.name}</p>
                  <p className="text-xs text-slate-400">{r.customer.name} · {r.customer.phone}</p>
                  <p className="mt-1 text-sm" dir="ltr">{"⭐".repeat(r.rating)}</p>
                  {r.comment && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{r.comment}</p>}
                </div>
              </div>
              <div className="mt-2.5 flex justify-end gap-1.5">
                {r.status !== "APPROVED" && (
                  <button
                    onClick={() => setStatusMut.mutate({ id: r.id, next: "APPROVED" })}
                    className="flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
                  >
                    <Check className="h-3.5 w-3.5" /> نشر
                  </button>
                )}
                {r.status !== "REJECTED" && (
                  <button
                    onClick={() => setStatusMut.mutate({ id: r.id, next: "REJECTED" })}
                    className="flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-200"
                  >
                    <X className="h-3.5 w-3.5" /> رفض
                  </button>
                )}
                <button
                  onClick={() => deleteMut.mutate(r.id)}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" /> حذف
                </button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   Tab shell — pick a product, edit its storefront content, moderate reviews
══════════════════════════════════════════════════════════════════════ */
export function CatalogContentTab() {
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<string | null>(null)

  const productsQuery = useQuery({
    queryKey: ["catalog-content-products", search],
    queryFn: () => getProducts({ search: search.trim() || undefined, limit: 40 }),
  })
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="h-5 w-5 text-violet-600" />
            محتوى صفحة المنتج
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-800">
            اختر منتج وعبّي وصفه ومواصفاته وصوره الإضافية — تظهر للزبون لما يضغط على المنتج بالكتلوك.
          </p>

          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pr-9"
              placeholder="ابحث عن منتج بالاسم أو الرقم"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {productsQuery.isLoading && <p className="py-4 text-center text-sm text-slate-400">جاري التحميل...</p>}

          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(selected === p.id ? null : p.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border p-2 text-right transition",
                  selected === p.id ? "border-violet-400 bg-violet-50" : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border bg-slate-100">
                  {p.thumbnailUrl
                    ? <img src={p.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center"><ImageIcon className="h-4 w-4 text-slate-300" /></div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-400">{p.itemNumber}</p>
                </div>
              </button>
            ))}
            {!productsQuery.isLoading && products.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">ما في منتجات مطابقة</p>
            )}
          </div>

          {selected && (
            <div className="border-t pt-4">
              <ProductContentEditor productId={selected} />
            </div>
          )}
        </CardContent>
      </Card>

      <ReviewsSection />
    </div>
  )
}
