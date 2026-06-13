import { useMemo, useRef, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Boxes,
  CheckCircle2,
  Clock,
  Copy,
  FolderTree,
  ImagePlus,
  Megaphone,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Star,
  Store,
  Tag,
  TrendingUp,
  Trash2,
  Users,
  X,
} from "lucide-react"
import {
  broadcastToRetailCustomers,
  cancelRetailOrder,
  createRetailCategory,
  createRetailCoupon,
  createRetailItem,
  deleteRetailCategory,
  deleteRetailCoupon,
  deleteRetailItem,
  getProducts,
  getRetailCategories,
  getRetailCoupons,
  getRetailCustomers,
  getRetailItems,
  getRetailOrders,
  prepareRetailOrder,
  updateRetailCategory,
  updateRetailCoupon,
  updateRetailItem,
} from "../api/endpoints"
import type { Product, RetailCategory, RetailCoupon, RetailItem, RetailOrder } from "../types/api"
import { useSettings, useUpdateSettings } from "../hooks/useSettings"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { toast } from "../components/ui/use-toast"
import { cn } from "../utils/cn"

type Tab = "products" | "categories" | "customers" | "coupons" | "orders"

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const maxSide = 1000
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("فشل ضغط الصورة")
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.82)
}

function money(value: number) {
  return Number(value ?? 0).toLocaleString("en-US")
}

export function RetailCatalogPage() {
  usePageTitle("كتلوك المفرد")
  const initialTab = (new URLSearchParams(window.location.search).get("tab") as Tab) || "products"
  const validTabs: Tab[] = ["products", "categories", "customers", "coupons", "orders"]
  const [tab, setTab] = useState<Tab>(validTabs.includes(initialTab) ? initialTab : "products")
  const settings = useSettings().data
  const shopUrl = useMemo(() => {
    const base = settings?.catalogPublicUrl?.replace(/\/catalog.*$/, "") || window.location.origin
    return `${base.replace(/\/$/, "")}/shop`
  }, [settings])

  const pendingOrders = useQuery({ queryKey: ["retail-orders", "PENDING"], queryFn: () => getRetailOrders("PENDING") })
  const pendingCount = pendingOrders.data?.length ?? 0

  const [brandingOpen, setBrandingOpen] = useState(false)

  const TABS: { id: Tab; label: string; icon: typeof Store; badge?: number }[] = [
    { id: "products", label: "المنتجات", icon: Boxes },
    { id: "categories", label: "التصنيفات", icon: FolderTree },
    { id: "customers", label: "الزبائن", icon: Users },
    { id: "coupons", label: "الكوبونات", icon: Tag },
    { id: "orders", label: "الطلبات", icon: Clock, badge: pendingCount },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          {settings?.storeLogo ? (
            <img src={settings.storeLogo} alt="logo" className="h-11 w-11 rounded-xl object-contain ring-1 ring-slate-200" />
          ) : null}
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold"><Store className="h-6 w-6 text-indigo-500" /> {settings?.storeName || "كتلوك المفرد"}</h1>
            <p className="text-slate-500">متجر المفرد العام — المواد، التصنيفات، الزبائن، والطلبات.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBrandingOpen(true)}>الاسم والشعار</Button>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            <span className="truncate max-w-[180px] text-slate-600 dark:text-slate-300" dir="ltr">{shopUrl}</span>
            <button
              type="button"
              title="نسخ رابط المتجر"
              onClick={() => { void navigator.clipboard.writeText(shopUrl); toast({ title: "✓ تم نسخ رابط المتجر" }) }}
              className="text-indigo-600 hover:text-indigo-700"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <Button variant="outline" onClick={() => window.open(shopUrl, "_blank", "noopener,noreferrer")}>معاينة</Button>
        </div>
      </div>

      {brandingOpen && <BrandingDialog onClose={() => setBrandingOpen(false)} />}

      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5 dark:border-slate-700 dark:bg-slate-900">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition",
              tab === t.id ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
            {t.badge ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "products" && <ProductsTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "customers" && <CustomersTab />}
      {tab === "coupons" && <CouponsTab />}
      {tab === "orders" && <OrdersTab currency={settings?.currency ?? "د.ع"} />}
    </div>
  )
}

// ── Products tab ────────────────────────────────────────────────────────────
function ProductsTab() {
  const qc = useQueryClient()
  const itemsQuery = useQuery({ queryKey: ["retail-items"], queryFn: getRetailItems })
  const [editing, setEditing] = useState<RetailItem | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRetailItem(id),
    onSuccess: () => { setDeleteId(null); void qc.invalidateQueries({ queryKey: ["retail-items"] }) },
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => updateRetailItem(id, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["retail-items"] }),
  })

  const [search, setSearch] = useState("")
  const [perRow, setPerRow] = useState(8)
  const allItems = itemsQuery.data ?? []
  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allItems
    return allItems.filter((i) =>
      (i.title ?? "").toLowerCase().includes(q) ||
      i.productName.toLowerCase().includes(q) ||
      i.itemNumber.toLowerCase().includes(q) ||
      i.categories.some((c) => c.toLowerCase().includes(q)),
    )
  }, [allItems, search])

  const gridStyle = { gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pr-8" placeholder="بحث عن منتج بالاسم أو الرقم أو التصنيف..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">بالسطر:</span>
          <select
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            value={perRow}
            onChange={(e) => setPerRow(Number(e.target.value))}
          >
            {[4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" /> إضافة مادة
        </Button>
      </div>

      {itemsQuery.isLoading ? (
        <div className="py-10 text-center text-sm text-slate-400">جاري التحميل...</div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-500">{search ? "لا توجد نتائج مطابقة." : "لا توجد مواد بعد. اضغط \"إضافة مادة\" لعرض أول منتج للزبائن."}</CardContent></Card>
      ) : (
        <div className="grid gap-2" style={gridStyle}>
          {items.map((item) => (
            <div key={item.id} className={cn("overflow-hidden rounded-lg border border-slate-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900", !item.isActive && "opacity-50")}>
              <button type="button" onClick={() => { setEditing(item); setDialogOpen(true) }} className="relative block aspect-square w-full bg-slate-100 dark:bg-slate-800">
                {item.images[0] ? (
                  <img src={item.images[0]} alt={item.title ?? item.productName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-300"><ImagePlus className="h-6 w-6" /></div>
                )}
                {item.featured ? <span className="absolute right-1 top-1 rounded bg-amber-500 px-1 text-[8px] font-bold text-white">مميز</span> : null}
                <span className={cn("absolute left-1 top-1 rounded px-1 text-[8px] font-bold text-white", item.currentStock > 0 ? "bg-emerald-500" : "bg-rose-500")}>
                  {item.currentStock > 0 ? item.currentStock : "نفذ"}
                </span>
              </button>
              <div className="p-1.5">
                <div className="line-clamp-1 text-xs font-bold leading-tight">{item.title ?? item.productName}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xs font-extrabold text-indigo-600">{money(item.price)}</span>
                  {item.oldPrice && item.oldPrice > item.price ? <span className="text-[9px] text-slate-400 line-through">{money(item.oldPrice)}</span> : null}
                </div>
                <div className="mt-1 flex items-center gap-0.5">
                  <button type="button" title="تعديل" onClick={() => { setEditing(item); setDialogOpen(true) }} className="flex-1 rounded bg-slate-100 py-1 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"><Pencil className="mx-auto h-3 w-3" /></button>
                  <button type="button" title={item.isActive ? "إخفاء" : "إظهار"} onClick={() => toggleActive.mutate({ id: item.id, isActive: !item.isActive })} className="flex-1 rounded bg-slate-100 py-1 text-[9px] font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">{item.isActive ? "إخفاء" : "إظهار"}</button>
                  <button type="button" title="حذف" onClick={() => setDeleteId(item.id)} className="flex-1 rounded bg-rose-50 py-1 text-rose-600 hover:bg-rose-100"><Trash2 className="mx-auto h-3 w-3" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {dialogOpen && (
        <ItemDialog
          item={editing}
          onClose={() => setDialogOpen(false)}
          onSaved={() => { setDialogOpen(false); void qc.invalidateQueries({ queryKey: ["retail-items"] }) }}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="حذف المادة من الكتلوك؟"
        description="ستُحذف من متجر المفرد فقط ولا تتأثر بيانات المنتج الأصلي."
        confirmLabel="حذف"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId) }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}

function ItemDialog({ item, onClose, onSaved }: { item: RetailItem | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!item
  const productsQuery = useQuery({ queryKey: ["products", "retail-picker"], queryFn: () => getProducts({ limit: 1000 }) })
  const products = (productsQuery.data ?? []) as Product[]
  const categoriesQuery = useQuery({ queryKey: ["retail-categories"], queryFn: getRetailCategories })
  const categories = categoriesQuery.data ?? []

  const [productId, setProductId] = useState(item?.productId ?? "")
  const [productSearch, setProductSearch] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [title, setTitle] = useState(item?.title ?? "")
  const [description, setDescription] = useState(item?.description ?? "")
  const [price, setPrice] = useState(item ? String(item.price) : "")
  const [oldPrice, setOldPrice] = useState(item?.oldPrice ? String(item.oldPrice) : "")
  const [cats, setCats] = useState<string[]>(item?.categories ?? [])
  const [subs, setSubs] = useState<string[]>(item?.subCategories ?? [])
  const [images, setImages] = useState<string[]>(item?.images ?? [])
  const [featured, setFeatured] = useState(item?.featured ?? false)
  const [isBestSeller, setIsBestSeller] = useState(item?.isBestSeller ?? false)
  const [isNew, setIsNew] = useState(item?.isNew ?? false)
  const [isOffer, setIsOffer] = useState(item?.isOffer ?? false)
  const [lowStockBadge, setLowStockBadge] = useState(item?.lowStockBadge ?? false)
  const [sortOrder, setSortOrder] = useState(item ? String(item.sortOrder) : "0")
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const selectedProduct = products.find((p) => p.id === productId)
  const filteredProducts = productSearch.trim()
    ? products.filter((p) => p.name.includes(productSearch) || p.itemNumber.includes(productSearch)).slice(0, 8)
    : products.slice(0, 8)
  // Sub-options are the union of sub-categories of all selected main categories.
  const subOptions = [...new Set(categories.filter((c) => cats.includes(c.name)).flatMap((c) => c.subCategories))]

  function toggleCat(name: string) {
    setCats((cur) => (cur.includes(name) ? cur.filter((c) => c !== name) : [...cur, name]))
  }
  function toggleSub(name: string) {
    setSubs((cur) => (cur.includes(name) ? cur.filter((s) => s !== name) : [...cur, name]))
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        price: Number(price),
        oldPrice: oldPrice ? Number(oldPrice) : null,
        categories: cats,
        subCategories: subs.filter((s) => subOptions.includes(s)),
        images,
        featured,
        isBestSeller,
        isNew,
        isOffer,
        lowStockBadge,
        sortOrder: Number(sortOrder) || 0,
      }
      return isEdit ? updateRetailItem(item!.id, payload) : createRetailItem({ productId, ...payload })
    },
    onSuccess: onSaved,
  })

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      const next: string[] = []
      for (const file of Array.from(files).slice(0, 8 - images.length)) {
        next.push(await compressImage(file))
      }
      setImages((cur) => [...cur, ...next].slice(0, 8))
    } catch {
      toast({ title: "تعذر معالجة الصورة", variant: "destructive" })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const canSave = !!productId && Number(price) > 0 && !saveMutation.isPending
  const hasDiscount = oldPrice && Number(oldPrice) > Number(price || 0)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل مادة الكتلوك" : "إضافة مادة للكتلوك"}</DialogTitle></DialogHeader>
        <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
          {/* 1. Link to wholesale product */}
          {!isEdit ? (
            <div className="relative">
              <label className="mb-1 block text-xs font-semibold text-slate-500">١. مادة الجملة المرتبطة (للمخزون فقط)</label>
              <Input
                placeholder="اكتب اسم المادة بموقع الجملة للربط..."
                value={selectedProduct ? `${selectedProduct.name} (${selectedProduct.itemNumber})` : productSearch}
                onChange={(e) => { setProductId(""); setProductSearch(e.target.value); setPickerOpen(true) }}
                onFocus={() => setPickerOpen(true)}
              />
              {pickerOpen && filteredProducts.length > 0 && (
                <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950">
                  {filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-right text-sm hover:bg-indigo-50 dark:border-slate-800 dark:hover:bg-slate-800"
                      onClick={() => { setProductId(p.id); setPickerOpen(false); setProductSearch("") }}
                    >
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-slate-500">{p.itemNumber} • متوفر {p.currentStock ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900">
              مادة الجملة: <span className="font-semibold">{item!.productName}</span> ({item!.itemNumber}) • متوفر {item!.currentStock}
            </div>
          )}

          {/* 2. Retail display name */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">٢. اسم المادة بموقع المفرد</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={selectedProduct?.name ?? "الاسم كما يظهر للزبون"} />
          </div>

          {/* 3. Description */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">٣. الوصف</label>
            <textarea
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="تفاصيل المادة..."
            />
          </div>

          {/* 4. Prices */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">٤. السعر الحالي (د.ع)</label>
              <Input inputMode="numeric" dir="ltr" value={price} onFocus={(e) => e.target.select()} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">السعر القديم (اختياري)</label>
              <Input inputMode="numeric" dir="ltr" value={oldPrice} onFocus={(e) => e.target.select()} onChange={(e) => setOldPrice(e.target.value.replace(/[^0-9]/g, ""))} placeholder="—" />
            </div>
          </div>
          {hasDiscount ? (
            <div className="text-xs font-semibold text-emerald-600">سيظهر للزبون خصم {Math.round((1 - Number(price) / Number(oldPrice)) * 100)}% (السعر القديم مشطوب)</div>
          ) : null}

          {/* 5. Categories (multi) + sub (multi) */}
          {categories.length === 0 ? (
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              لا توجد تصنيفات بعد — أضف تصنيفات من تبويب "التصنيفات" (تكدر تختار أكثر من تصنيف للمادة).
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">التصنيفات الرئيسية (تكدر تختار أكثر من واحد)</label>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCat(c.name)}
                      className={cn("rounded-full px-3 py-1 text-xs font-medium transition", cats.includes(c.name) ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300")}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
              {subOptions.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">التصنيفات الثانوية</label>
                  <div className="flex flex-wrap gap-1.5">
                    {subOptions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleSub(s)}
                        className={cn("rounded-full px-2.5 py-0.5 text-[11px] transition", subs.includes(s) ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300" : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400")}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Images */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">٥. الصور ({images.length}/8)</label>
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative h-20 w-20 overflow-hidden rounded-lg ring-1 ring-slate-200">
                  <img src={img} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setImages((cur) => cur.filter((_, idx) => idx !== i))} className="absolute right-0 top-0 rounded-bl-lg bg-rose-600 p-0.5 text-white">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {images.length < 8 && (
                <button type="button" onClick={() => fileRef.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 dark:border-slate-600">
                  <ImagePlus className="h-5 w-5" />
                  <span className="text-[10px]">{uploading ? "..." : "إضافة"}</span>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onPickFiles(e.target.files)} />
          </div>

          {/* Collections / badges */}
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="text-xs font-semibold text-slate-500">الظهور والمجموعات</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="h-4 w-4" /><Sparkles className="h-4 w-4 text-violet-500" /> بالبنل المتحرك</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={isBestSeller} onChange={(e) => setIsBestSeller(e.target.checked)} className="h-4 w-4" /><TrendingUp className="h-4 w-4 text-emerald-500" /> الأكثر مبيعاً</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={isOffer} onChange={(e) => setIsOffer(e.target.checked)} className="h-4 w-4" /><Tag className="h-4 w-4 text-orange-500" /> ضمن العروض</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={isNew} onChange={(e) => setIsNew(e.target.checked)} className="h-4 w-4" /><Star className="h-4 w-4 text-blue-500" /> جديد</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={lowStockBadge} onChange={(e) => setLowStockBadge(e.target.checked)} className="h-4 w-4" /><span className="text-rose-500">⚠</span> شارة "كمية قليلة"</label>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <label className="text-xs font-semibold text-slate-500">ترتيب الظهور</label>
              <Input className="h-8 w-24" inputMode="numeric" dir="ltr" value={sortOrder} onChange={(e) => setSortOrder(e.target.value.replace(/[^0-9]/g, ""))} />
              <span className="text-[11px] text-slate-400">الأصغر يظهر أولاً</span>
            </div>
          </div>

          <Button className="w-full" disabled={!canSave} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "جاري الحفظ..." : isEdit ? "حفظ التعديلات" : "إضافة للكتلوك"}
          </Button>
          {saveMutation.isError ? (
            <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
              {saveMutation.error instanceof Error ? saveMutation.error.message : "تعذر الحفظ"}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Categories tab ────────────────────────────────────────────────────────────
function CategoriesTab() {
  const qc = useQueryClient()
  const categoriesQuery = useQuery({ queryKey: ["retail-categories"], queryFn: getRetailCategories })
  const [editing, setEditing] = useState<RetailCategory | null>(null)
  const [open, setOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRetailCategory(id),
    onSuccess: () => { setDeleteId(null); void qc.invalidateQueries({ queryKey: ["retail-categories"] }) },
  })

  const categories = categoriesQuery.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">تصنيفات خاصة بالمفرد (مستقلة عن الجملة) — رئيسية وتحتها ثانوية.</p>
        <Button onClick={() => { setEditing(null); setOpen(true) }}><Plus className="h-4 w-4" /> تصنيف جديد</Button>
      </div>
      {categoriesQuery.isLoading ? (
        <div className="py-10 text-center text-sm text-slate-400">جاري التحميل...</div>
      ) : categories.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-500">لا توجد تصنيفات. أضف أول تصنيف ليظهر للزبون كفلتر.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.map((cat) => (
            <Card key={cat.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="font-bold">{cat.name}</div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => { setEditing(cat); setOpen(true) }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="outline" size="sm" className="border-rose-300 text-rose-600 hover:bg-rose-50" onClick={() => setDeleteId(cat.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                {cat.subCategories.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {cat.subCategories.map((s) => <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{s}</span>)}
                  </div>
                ) : <div className="mt-2 text-xs text-slate-400">بدون تصنيفات ثانوية</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {open && <CategoryDialog category={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); void qc.invalidateQueries({ queryKey: ["retail-categories"] }) }} />}

      <ConfirmDialog
        open={!!deleteId}
        title="حذف التصنيف؟"
        description="المواد المرتبطة بهذا التصنيف ستبقى لكن بدون تصنيف."
        confirmLabel="حذف"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId) }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}

function CategoryDialog({ category, onClose, onSaved }: { category: RetailCategory | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!category
  const [name, setName] = useState(category?.name ?? "")
  const [subs, setSubs] = useState<string[]>(category?.subCategories ?? [])
  const [subDraft, setSubDraft] = useState("")

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), subCategories: subs }
      return isEdit ? updateRetailCategory(category!.id, payload) : createRetailCategory(payload)
    },
    onSuccess: onSaved,
  })

  function addSub() {
    const v = subDraft.trim()
    if (v && !subs.includes(v)) setSubs((cur) => [...cur, v])
    setSubDraft("")
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل التصنيف" : "تصنيف جديد"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم التصنيف الرئيسي (مثل: ألعاب)" />
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">التصنيفات الثانوية</label>
            <div className="flex gap-2">
              <Input value={subDraft} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub() } }} placeholder="اكتب واضغط إضافة" />
              <Button type="button" variant="outline" onClick={addSub}>إضافة</Button>
            </div>
            {subs.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {subs.map((s) => (
                  <span key={s} className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200">
                    {s}
                    <button type="button" onClick={() => setSubs((cur) => cur.filter((x) => x !== s))}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <Button className="w-full" disabled={name.trim().length < 1 || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جاري الحفظ..." : "حفظ"}
          </Button>
          {save.isError ? <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{save.error instanceof Error ? save.error.message : "تعذر الحفظ"}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Store branding dialog (name + logo) ───────────────────────────────────────
function BrandingDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings().data
  const updateSettings = useUpdateSettings()
  const [name, setName] = useState(settings?.storeName ?? "")
  const [logo, setLogo] = useState(settings?.storeLogo ?? "")
  const [staffPhones, setStaffPhones] = useState(settings?.orderPreparationWhatsappNumbers ?? "")
  const [designerName, setDesignerName] = useState(settings?.siteDesignerName ?? "")
  const [designerPhone, setDesignerPhone] = useState(settings?.siteDesignerPhone ?? "")
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  async function pickLogo(file: File | null) {
    if (!file) return
    setBusy(true)
    try { setLogo(await compressImage(file)) } catch { toast({ title: "تعذر معالجة الصورة", variant: "destructive" }) } finally { setBusy(false) }
  }

  async function save() {
    setBusy(true)
    try {
      await updateSettings.mutateAsync({
        storeName: name.trim(),
        storeLogo: logo,
        orderPreparationWhatsappNumbers: staffPhones.trim(),
        siteDesignerName: designerName.trim(),
        siteDesignerPhone: designerPhone.trim(),
      })
      toast({ title: "✓ تم حفظ الإعدادات" })
      onClose()
    } catch {
      toast({ title: "تعذر الحفظ", variant: "destructive" })
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>إعدادات المتجر</DialogTitle></DialogHeader>
        <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">اسم المتجر</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم متجرك" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">الشعار</label>
            <div className="flex items-center gap-3">
              {logo ? <img src={logo} alt="logo" className="h-16 w-16 rounded-xl object-contain ring-1 ring-slate-200" /> : <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-slate-300"><ImagePlus className="h-6 w-6" /></div>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>{busy ? "..." : "رفع شعار"}</Button>
                {logo ? <Button type="button" variant="outline" className="text-rose-600" onClick={() => setLogo("")}>إزالة</Button> : null}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickLogo(e.target.files?.[0] ?? null)} />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <label className="mb-1 block text-xs font-semibold text-slate-500">أرقام عمال التجهيز (واتساب)</label>
            <textarea
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              rows={2}
              dir="ltr"
              value={staffPhones}
              onChange={(e) => setStaffPhones(e.target.value)}
              placeholder="07XXXXXXXXX، 07XXXXXXXXX"
            />
            <p className="mt-1 text-[11px] text-slate-400">يصلهم إشعار واتساب بكل طلب مفرد جديد للتجهيز (افصل بين الأرقام بفاصلة أو سطر). نفس أرقام تجهيز الجملة.</p>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <label className="mb-1 block text-xs font-semibold text-slate-500">دعاية المصمم (تظهر أسفل صفحة الزبون)</label>
            <div className="grid grid-cols-2 gap-2">
              <Input value={designerName} onChange={(e) => setDesignerName(e.target.value)} placeholder="اسم المصمم" />
              <Input value={designerPhone} onChange={(e) => setDesignerPhone(e.target.value)} placeholder="رقم الهاتف" dir="ltr" />
            </div>
          </div>

          <Button className="w-full" disabled={busy || name.trim().length < 1} onClick={() => void save()}>{busy ? "جاري الحفظ..." : "حفظ"}</Button>
          <p className="text-center text-[11px] text-slate-400">اسم المتجر والشعار يظهران بصفحة الزبون والشريط الجانبي وطباعة الفاتورة</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Customers + broadcast tab ─────────────────────────────────────────────────
function CustomersTab() {
  const categoriesQuery = useQuery({ queryKey: ["retail-categories"], queryFn: getRetailCategories })
  const categories = categoriesQuery.data ?? []
  const [category, setCategory] = useState<string>("")
  const [subscribersOnly, setSubscribersOnly] = useState(false)

  const customersQuery = useQuery({
    queryKey: ["retail-customers", category, subscribersOnly],
    queryFn: () => getRetailCustomers({ category: category || undefined, subscribersOnly }),
  })
  const customers = customersQuery.data ?? []

  const [composeOpen, setComposeOpen] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">كل الاهتمامات</option>
          {categories.map((c) => (
            <optgroup key={c.id} label={c.name}>
              <option value={c.name}>{c.name} (الكل)</option>
              {c.subCategories.map((s) => <option key={`${c.id}-${s}`} value={s}>{c.name} › {s}</option>)}
            </optgroup>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={subscribersOnly} onChange={(e) => setSubscribersOnly(e.target.checked)} className="h-4 w-4" />
          الزبائن الدائمين فقط
        </label>
        <div className="flex-1" />
        <span className="text-sm text-slate-500">{customers.length} زبون</span>
        <Button onClick={() => setComposeOpen(true)} disabled={customers.length === 0}>
          <Megaphone className="h-4 w-4" /> إرسال للجميع
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR><TH>الاسم</TH><TH>الهاتف</TH><TH>الاهتمامات</TH><TH>طلبات</TH><TH>دائم؟</TH></TR>
            </THead>
            <TBody>
              {customersQuery.isLoading && <TR><TD colSpan={5} className="py-8 text-center text-sm text-slate-400">جاري التحميل...</TD></TR>}
              {!customersQuery.isLoading && customers.length === 0 && <TR><TD colSpan={5} className="py-8 text-center text-slate-500">لا يوجد زبائن مطابقين بعد.</TD></TR>}
              {customers.map((c) => (
                <TR key={c.id}>
                  <TD className="font-semibold">{c.name}</TD>
                  <TD dir="ltr">{c.phone}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {c.interests.slice(0, 4).map((i) => <span key={i} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{i}</span>)}
                      {c.interests.length > 4 ? <span className="text-[10px] text-slate-400">+{c.interests.length - 4}</span> : null}
                      {c.wishNote ? <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700" title="يبحث عن">🔎 {c.wishNote}</span> : null}
                    </div>
                  </TD>
                  <TD>{c.ordersCount}</TD>
                  <TD>{c.isSubscriber ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">دائم</span> : <span className="text-xs text-slate-400">—</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {composeOpen && (
        <BroadcastDialog
          recipientCount={customers.length}
          category={category || undefined}
          subscribersOnly={subscribersOnly}
          onClose={() => setComposeOpen(false)}
        />
      )}
    </div>
  )
}

function BroadcastDialog({ recipientCount, category, subscribersOnly, onClose }: {
  recipientCount: number
  category?: string
  subscribersOnly: boolean
  onClose: () => void
}) {
  const [message, setMessage] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const sendMutation = useMutation({
    mutationFn: () => broadcastToRetailCustomers({ message: message.trim(), images, category, subscribersOnly }),
    onSuccess: (res) => {
      toast({ title: res.message ?? `جارٍ الإرسال إلى ${recipientCount} زبون` })
      onClose()
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر الإرسال", variant: "destructive" }),
  })

  async function pickFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      const next: string[] = []
      for (const file of Array.from(files).slice(0, 3 - images.length)) next.push(await compressImage(file))
      setImages((cur) => [...cur, ...next].slice(0, 3))
    } catch { toast({ title: "تعذر معالجة الصورة", variant: "destructive" }) } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>رسالة جماعية للزبائن</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200">
            سترسل إلى <b>{recipientCount}</b> زبون{category ? ` مهتمين بـ "${category}"` : ""}{subscribersOnly ? " (الدائمين فقط)" : ""}. رابط المتجر يُضاف تلقائياً.
          </div>
          <textarea
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="نص الرسالة... (مثال: وصلت بضاعة جديدة! تفضلوا شوفوها 🎁)"
          />
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">صور (لحد ٣)</label>
            <div className="flex flex-wrap gap-2">
              {images.map((img, i) => (
                <div key={i} className="relative h-20 w-20 overflow-hidden rounded-lg ring-1 ring-slate-200">
                  <img src={img} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => setImages((cur) => cur.filter((_, idx) => idx !== i))} className="absolute right-0 top-0 rounded-bl-lg bg-rose-600 p-0.5 text-white"><X className="h-3 w-3" /></button>
                </div>
              ))}
              {images.length < 3 && (
                <button type="button" onClick={() => fileRef.current?.click()} className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-slate-400 hover:border-indigo-400 dark:border-slate-600">
                  <ImagePlus className="h-5 w-5" /><span className="text-[10px]">{uploading ? "..." : "إضافة"}</span>
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void pickFiles(e.target.files)} />
          </div>
          <Button className="w-full" disabled={message.trim().length < 1 || sendMutation.isPending} onClick={() => setConfirm(true)}>
            <Send className="h-4 w-4" /> إرسال الآن
          </Button>
          <p className="text-center text-[11px] text-slate-400">ملاحظة: على WhatsApp Cloud API قد لا تصل الرسائل الدعائية للزبائن خارج نافذة ٢٤ ساعة.</p>
        </div>
      </DialogContent>
      <ConfirmDialog
        open={confirm}
        title={`إرسال إلى ${recipientCount} زبون؟`}
        description="سيتم الإرسال بالتتابع مع تمهّل بسيط بين كل رسالة."
        confirmLabel="إرسال"
        loading={sendMutation.isPending}
        onConfirm={() => { setConfirm(false); sendMutation.mutate() }}
        onCancel={() => setConfirm(false)}
      />
    </Dialog>
  )
}

// ── Coupons tab ─────────────────────────────────────────────────────────────
function CouponsTab() {
  const qc = useQueryClient()
  const couponsQuery = useQuery({ queryKey: ["retail-coupons"], queryFn: getRetailCoupons })
  const [editing, setEditing] = useState<RetailCoupon | null>(null)
  const [open, setOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRetailCoupon(id),
    onSuccess: () => { setDeleteId(null); void qc.invalidateQueries({ queryKey: ["retail-coupons"] }) },
  })

  const coupons = couponsQuery.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setOpen(true) }}><Plus className="h-4 w-4" /> كوبون خصم للمفرد</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR><TH>الكود</TH><TH>الاسم</TH><TH>الخصم</TH><TH>الاستخدام</TH><TH>الحالة</TH><TH>إجراءات</TH></TR>
            </THead>
            <TBody>
              {coupons.length === 0 && <TR><TD colSpan={6} className="py-8 text-center text-slate-500">لا توجد كوبونات للمفرد.</TD></TR>}
              {coupons.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono font-bold">{c.code}</TD>
                  <TD>{c.name}</TD>
                  <TD>{c.discountType === "PERCENT" ? `${c.discountValue}%` : `${money(c.discountValue)} د.ع`}</TD>
                  <TD>{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</TD>
                  <TD>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", c.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                      {c.isActive ? "فعال" : "متوقف"}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" onClick={() => { setEditing(c); setOpen(true) }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="outline" size="sm" className="border-rose-300 text-rose-600 hover:bg-rose-50" onClick={() => setDeleteId(c.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {open && <CouponDialog coupon={editing} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); void qc.invalidateQueries({ queryKey: ["retail-coupons"] }) }} />}

      <ConfirmDialog
        open={!!deleteId}
        title="حذف الكوبون؟"
        confirmLabel="حذف"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId) }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}

function CouponDialog({ coupon, onClose, onSaved }: { coupon: RetailCoupon | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!coupon
  const [code, setCode] = useState(coupon?.code ?? "")
  const [name, setName] = useState(coupon?.name ?? "")
  const [discountType, setDiscountType] = useState<"PERCENT" | "AMOUNT">(coupon?.discountType ?? "PERCENT")
  const [discountValue, setDiscountValue] = useState(coupon ? String(coupon.discountValue) : "")
  const [isActive, setIsActive] = useState(coupon?.isActive ?? true)

  const save = useMutation({
    mutationFn: () => {
      const payload = { code: code.trim(), name: name.trim(), discountType, discountValue: Number(discountValue), isActive }
      return isEdit ? updateRetailCoupon(coupon!.id, payload) : createRetailCoupon(payload)
    },
    onSuccess: onSaved,
  })

  const canSave = code.trim().length >= 2 && name.trim().length >= 1 && Number(discountValue) > 0 && !save.isPending

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل الكوبون" : "كوبون خصم للمفرد"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="الكود (مثل: MUFRAD10)" dir="ltr" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الكوبون (يظهر للزبون)" />
          <div className="flex gap-2">
            {(["PERCENT", "AMOUNT"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setDiscountType(t)} className={cn("flex-1 rounded-md border px-3 py-2 text-sm font-medium", discountType === t ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200")}>
                {t === "PERCENT" ? "نسبة %" : "مبلغ ثابت"}
              </button>
            ))}
          </div>
          <Input inputMode="numeric" dir="ltr" value={discountValue} onChange={(e) => setDiscountValue(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={discountType === "PERCENT" ? "نسبة الخصم %" : "مبلغ الخصم"} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" /> فعال
          </label>
          <Button className="w-full" disabled={!canSave} onClick={() => save.mutate()}>{save.isPending ? "جاري الحفظ..." : "حفظ"}</Button>
          {save.isError ? <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{save.error instanceof Error ? save.error.message : "تعذر الحفظ"}</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Orders tab ──────────────────────────────────────────────────────────────
function OrdersTab({ currency }: { currency: string }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<"PENDING" | "PREPARED" | "CANCELLED">("PENDING")
  const ordersQuery = useQuery({ queryKey: ["retail-orders", status], queryFn: () => getRetailOrders(status) })
  const [prepareId, setPrepareId] = useState<RetailOrder | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)

  const prepareMutation = useMutation({
    mutationFn: (id: string) => prepareRetailOrder(id),
    onSuccess: (res) => {
      setPrepareId(null)
      toast({ title: res.message ?? "تم تجهيز الطلب وإشعار الزبون" })
      void qc.invalidateQueries({ queryKey: ["retail-orders"] })
      void qc.invalidateQueries({ queryKey: ["invoices"] })
    },
    onError: (e) => { setPrepareId(null); toast({ title: e instanceof Error ? e.message : "تعذر التجهيز", variant: "destructive" }) },
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelRetailOrder(id),
    onSuccess: () => { setCancelId(null); void qc.invalidateQueries({ queryKey: ["retail-orders"] }) },
  })

  const orders = ordersQuery.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {([["PENDING", "قيد التجهيز"], ["PREPARED", "مجهزة"], ["CANCELLED", "ملغاة"]] as const).map(([s, label]) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn("rounded-lg px-4 py-2 text-sm font-medium transition", status === s ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
            {label}
          </button>
        ))}
      </div>

      {ordersQuery.isLoading ? (
        <div className="py-10 text-center text-sm text-slate-400">جاري التحميل...</div>
      ) : orders.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-500">لا توجد طلبات.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-indigo-600">{order.orderNumber}</span>
                      {order.status === "PENDING" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">قيد التجهيز</span>}
                      {order.status === "PREPARED" && <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> مجهز</span>}
                      {order.status === "CANCELLED" && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700">ملغي</span>}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{order.customerName}</div>
                    <div className="text-xs text-slate-500" dir="ltr">{order.phone}</div>
                    {order.address ? <div className="text-xs text-slate-500">📍 {order.address}</div> : null}
                    {order.notes ? <div className="text-xs text-slate-500">📝 {order.notes}</div> : null}
                    <div className="text-[11px] text-slate-400">{new Date(order.createdAt).toLocaleString("en-GB")}</div>
                  </div>
                  <div className="text-left">
                    <div className="text-lg font-extrabold">{money(order.total)} <span className="text-xs font-normal text-slate-500">{currency}</span></div>
                    {order.discount > 0 ? <div className="text-xs text-emerald-600">خصم {money(order.discount)} ({order.couponCode})</div> : null}
                  </div>
                </div>

                <div className="mt-3 rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-900">
                  {order.items.map((it, i) => (
                    <div key={i} className="flex justify-between border-b border-slate-100 py-1 last:border-0 dark:border-slate-800">
                      <span>{it.title}</span>
                      <span className="text-slate-500">{it.quantity} × {money(it.unitPrice)}</span>
                    </div>
                  ))}
                </div>

                {order.status === "PENDING" && (
                  <div className="mt-3 flex gap-2">
                    <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setPrepareId(order)}>
                      <CheckCircle2 className="h-4 w-4" /> تم التجهيز
                    </Button>
                    <Button variant="outline" className="border-rose-300 text-rose-600 hover:bg-rose-50" onClick={() => setCancelId(order.id)}>إلغاء</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!prepareId}
        title={`تجهيز الطلب ${prepareId?.orderNumber ?? ""}؟`}
        description="سيتم إنشاء فاتورة بيع نقدية باسم (زبون كتلوك المفرد) وخصم المخزون، وإرسال رسالة للزبون أن طلبه في الطريق."
        confirmLabel="تم التجهيز"
        loading={prepareMutation.isPending}
        onConfirm={() => { if (prepareId) prepareMutation.mutate(prepareId.id) }}
        onCancel={() => setPrepareId(null)}
      />
      <ConfirmDialog
        open={!!cancelId}
        title="إلغاء الطلب؟"
        confirmLabel="إلغاء الطلب"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => { if (cancelId) cancelMutation.mutate(cancelId) }}
        onCancel={() => setCancelId(null)}
      />
    </div>
  )
}
