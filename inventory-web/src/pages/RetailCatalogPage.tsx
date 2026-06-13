import { useMemo, useRef, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Boxes,
  CheckCircle2,
  Clock,
  Copy,
  ImagePlus,
  Pencil,
  Plus,
  Star,
  Store,
  Tag,
  Trash2,
  X,
} from "lucide-react"
import {
  cancelRetailOrder,
  createRetailCoupon,
  createRetailItem,
  deleteRetailCoupon,
  deleteRetailItem,
  getProducts,
  getRetailCoupons,
  getRetailItems,
  getRetailOrders,
  prepareRetailOrder,
  updateRetailCoupon,
  updateRetailItem,
} from "../api/endpoints"
import type { Product, RetailCoupon, RetailItem, RetailOrder } from "../types/api"
import { useSettings } from "../hooks/useSettings"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { toast } from "../components/ui/use-toast"
import { cn } from "../utils/cn"

type Tab = "products" | "coupons" | "orders"

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
  const [tab, setTab] = useState<Tab>("products")
  const settings = useSettings().data
  const shopUrl = useMemo(() => {
    const base = settings?.catalogPublicUrl?.replace(/\/catalog.*$/, "") || window.location.origin
    return `${base.replace(/\/$/, "")}/shop`
  }, [settings])

  const pendingOrders = useQuery({ queryKey: ["retail-orders", "PENDING"], queryFn: () => getRetailOrders("PENDING") })
  const pendingCount = pendingOrders.data?.length ?? 0

  const TABS: { id: Tab; label: string; icon: typeof Store; badge?: number }[] = [
    { id: "products", label: "المنتجات", icon: Boxes },
    { id: "coupons", label: "الكوبونات", icon: Tag },
    { id: "orders", label: "الطلبات", icon: Clock, badge: pendingCount },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Store className="h-6 w-6 text-indigo-500" /> كتلوك المفرد</h1>
          <p className="text-slate-500">متجر المفرد العام — اختر المواد، الكوبونات، وتابع الطلبات.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            <span className="truncate max-w-[220px] text-slate-600 dark:text-slate-300" dir="ltr">{shopUrl}</span>
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

  const items = itemsQuery.data ?? []

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => { setEditing(null); setDialogOpen(true) }}>
          <Plus className="h-4 w-4" /> إضافة مادة للكتلوك
        </Button>
      </div>

      {itemsQuery.isLoading ? (
        <div className="py-10 text-center text-sm text-slate-400">جاري التحميل...</div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-500">لا توجد مواد بعد. اضغط "إضافة مادة" لعرض أول منتج للزبائن.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className={cn("overflow-hidden", !item.isActive && "opacity-60")}>
              <div className="relative aspect-square bg-slate-100 dark:bg-slate-800">
                {item.images[0] ? (
                  <img src={item.images[0]} alt={item.title ?? item.productName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-300"><ImagePlus className="h-10 w-10" /></div>
                )}
                {item.featured ? (
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white"><Star className="h-3 w-3" /> مميز</span>
                ) : null}
                <span className={cn(
                  "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold",
                  item.currentStock > 0 ? "bg-emerald-500 text-white" : "bg-rose-500 text-white",
                )}>
                  {item.currentStock > 0 ? `متوفر: ${item.currentStock}` : "نفذ"}
                </span>
              </div>
              <CardContent className="space-y-2 p-3">
                <div className="font-bold leading-tight">{item.title ?? item.productName}</div>
                <div className="text-xs text-slate-500">{item.productName} • {item.itemNumber}</div>
                <div className="text-lg font-extrabold text-indigo-600">{money(item.price)} <span className="text-xs font-normal text-slate-500">د.ع</span></div>
                <div className="flex items-center gap-1 pt-1">
                  <Button variant="outline" size="sm" onClick={() => { setEditing(item); setDialogOpen(true) }}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="outline" size="sm" onClick={() => toggleActive.mutate({ id: item.id, isActive: !item.isActive })}>
                    {item.isActive ? "إخفاء" : "إظهار"}
                  </Button>
                  <Button variant="outline" size="sm" className="border-rose-300 text-rose-600 hover:bg-rose-50" onClick={() => setDeleteId(item.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
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

  const [productId, setProductId] = useState(item?.productId ?? "")
  const [productSearch, setProductSearch] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [title, setTitle] = useState(item?.title ?? "")
  const [description, setDescription] = useState(item?.description ?? "")
  const [price, setPrice] = useState(item ? String(item.price) : "")
  const [images, setImages] = useState<string[]>(item?.images ?? [])
  const [featured, setFeatured] = useState(item?.featured ?? false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const selectedProduct = products.find((p) => p.id === productId)
  const filteredProducts = productSearch.trim()
    ? products.filter((p) => p.name.includes(productSearch) || p.itemNumber.includes(productSearch)).slice(0, 8)
    : products.slice(0, 8)

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        price: Number(price),
        images,
        featured,
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

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل مادة الكتلوك" : "إضافة مادة للكتلوك"}</DialogTitle></DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {/* Product picker */}
          {!isEdit ? (
            <div className="relative">
              <label className="mb-1 block text-xs font-semibold text-slate-500">المنتج (للمخزون فقط)</label>
              <Input
                placeholder="ابحث عن المنتج بالاسم أو الرقم..."
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
              المنتج: <span className="font-semibold">{item!.productName}</span> ({item!.itemNumber}) • متوفر {item!.currentStock}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">اسم العرض (اختياري)</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={selectedProduct?.name ?? "اسم المادة كما يظهر للزبون"} />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">السعر للقطعة (د.ع)</label>
            <Input inputMode="numeric" dir="ltr" value={price} onFocus={(e) => e.target.select()} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">الوصف (اختياري)</label>
            <textarea
              className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="تفاصيل المادة..."
            />
          </div>

          {/* Images */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">الصور ({images.length}/8)</label>
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

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="h-4 w-4" />
            <Star className="h-4 w-4 text-amber-500" /> مادة مميزة (تظهر بالمقدمة)
          </label>

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
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر التجهيز", variant: "destructive" }),
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
