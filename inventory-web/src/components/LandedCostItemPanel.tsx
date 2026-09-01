import { useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { toast } from "./ui/use-toast"
import { cn } from "../utils/cn"
import { apiErrorMessage } from "../utils/apiError"
import {
  getCatalogCategories,
  getProducts,
  setLandedCostItemDecision,
  type LandedCostItem,
} from "../api/endpoints"

function money(n: number | null | undefined) {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("en-US")
}

/**
 * Shrink a picked photo before it becomes a data URL.
 *
 * The draft is stored as JSON on the batch row, so a raw 4 MB phone photo would
 * be carried on every read of this batch. 800 px wide at JPEG 0.82 keeps a
 * product thumbnail readable at a fraction of that.
 */
async function fileToCompressedDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("تعذّر قراءة الصورة"))
    reader.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("الملف ليس صورة صالحة"))
    el.src = raw
  })
  const maxSide = 800
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) return raw
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.82)
}

type Draft = NonNullable<LandedCostItem["newProductDraft"]>

/**
 * Everything about ONE row of a priced order, in one place.
 *
 * The list behind this panel stays compact on purpose — a 300-line China order
 * is unreadable when every row carries an open form. Details live here, and the
 * list keeps only what you scan for: code, cost, decision, name, sale price.
 */
export function LandedCostItemPanel(props: {
  item: LandedCostItem | null
  batchId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Name of another row in this batch already creating a product with a code. */
  codeTakenBy: (code: string, exceptItemId: string) => string | null
  onSaved?: () => void
}) {
  // Keyed by item id so opening a different row REMOUNTS the body: the form
  // state is then seeded from that row's own values, never carried over from
  // whichever row was open before.
  if (!props.item) return null
  return <PanelBody key={props.item.id} {...props} item={props.item} />
}

function PanelBody({
  item,
  batchId,
  open,
  onOpenChange,
  codeTakenBy,
  onSaved,
}: {
  item: LandedCostItem
  batchId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  codeTakenBy: (code: string, exceptItemId: string) => string | null
  onSaved?: () => void
}) {
  const queryClient = useQueryClient()
  const catsQuery = useQuery({ queryKey: ["catalog-categories"], queryFn: getCatalogCategories })
  const cats = useMemo(() => catsQuery.data ?? [], [catsQuery.data])

  const [draft, setDraft] = useState<Draft>(() => ({
    name: item.newProductDraft?.name ?? item.productName ?? "",
    itemCode: item.newProductDraft?.itemCode ?? item.itemCode ?? "",
    barcode: item.newProductDraft?.barcode ?? "",
    category: item.newProductDraft?.category ?? "",
    pcsPerCarton: item.newProductDraft?.pcsPerCarton ?? item.piecesPerCarton ?? undefined,
    imageUrl: item.newProductDraft?.imageUrl ?? "",
    categoryTags: item.newProductDraft?.categoryTags ?? [],
    typeTags: item.newProductDraft?.typeTags ?? [],
    storageLocation: item.newProductDraft?.storageLocation ?? "",
  }))
  const [salePrice, setSalePrice] = useState<number | undefined>(
    item.confirmedSalePrice ?? item.suggestedSalePrice ?? undefined,
  )
  const [mode, setMode] = useState<"CREATE_NEW" | "LINK_EXISTING" | "SKIP">(
    item.action === "PENDING" ? (item.product ? "LINK_EXISTING" : "CREATE_NEW") : item.action,
  )
  const [linkedProduct, setLinkedProduct] = useState<{ id: string; name: string } | null>(
    item.product ? { id: item.product.id, name: item.product.name } : null,
  )
  const [search, setSearch] = useState("")
  const fileRef = useRef<HTMLInputElement | null>(null)

  const productSearch = useQuery({
    queryKey: ["product-search", search],
    queryFn: () => getProducts({ search, limit: 10 }),
    enabled: open && mode === "LINK_EXISTING" && search.trim().length >= 2,
  })

  const decisionMutation = useMutation({
    mutationFn: (payload: Parameters<typeof setLandedCostItemDecision>[2]) =>
      setLandedCostItemDecision(batchId, item.id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["landed-cost-batch", batchId] })
      toast({ title: "انحفظ" })
      onSaved?.()
      onOpenChange(false)
    },
    onError: (err: unknown) =>
      toast({ title: "تعذّر حفظ القرار", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const typedCode = (draft.itemCode || item.itemCode || "").trim()
  const codeClash = mode === "CREATE_NEW" ? codeTakenBy(typedCode, item.id) : null

  // Types offered are only those belonging to the chosen categories — the same
  // rule the inventory page uses, so tags stay consistent across the system.
  const availableTypes = useMemo(() => {
    const chosen = cats.filter((c) => (draft.categoryTags ?? []).includes(c.name))
    return [...new Set(chosen.flatMap((c) => c.types))].sort()
  }, [cats, draft.categoryTags])

  function toggleCategory(name: string) {
    const current = draft.categoryTags ?? []
    const next = current.includes(name) ? current.filter((t) => t !== name) : [...current, name]
    // Dropping a category drops the types that only existed under it.
    const validTypes = new Set(cats.filter((c) => next.includes(c.name)).flatMap((c) => c.types))
    setDraft({
      ...draft,
      categoryTags: next,
      category: next[0] ?? draft.category ?? "",
      typeTags: (draft.typeTags ?? []).filter((t) => validTypes.has(t)),
    })
  }

  function toggleType(name: string) {
    const current = draft.typeTags ?? []
    setDraft({ ...draft, typeTags: current.includes(name) ? current.filter((t) => t !== name) : [...current, name] })
  }

  async function pickImage(file: File | undefined) {
    if (!file) return
    try {
      setDraft((d) => ({ ...d, imageUrl: "" }))
      const dataUrl = await fileToCompressedDataUrl(file)
      setDraft((d) => ({ ...d, imageUrl: dataUrl }))
    } catch (err) {
      toast({ title: "تعذّر تحميل الصورة", description: (err as Error).message, variant: "destructive" })
    }
  }

  function save() {
    if (mode === "SKIP") {
      decisionMutation.mutate({ action: "SKIP" })
      return
    }
    if (mode === "LINK_EXISTING") {
      if (!linkedProduct) {
        toast({ title: "اختر المادة الموجودة أولاً", variant: "destructive" })
        return
      }
      decisionMutation.mutate({ action: "LINK_EXISTING", productId: linkedProduct.id, confirmedSalePrice: salePrice })
      return
    }
    if (!draft.name?.trim()) {
      toast({ title: "الاسم مطلوب", variant: "destructive" })
      return
    }
    if (!salePrice) {
      toast({ title: "سعر البيع مطلوب", description: "بدونه ما تنعرف المادة كم تنباع", variant: "destructive" })
      return
    }
    if (codeClash) {
      toast({ title: "رقم المادة مكرر", description: `الرقم «${typedCode}» مأخوذ من «${codeClash}»`, variant: "destructive" })
      return
    }
    decisionMutation.mutate({ action: "CREATE_NEW", newProductDraft: draft, confirmedSalePrice: salePrice })
  }

  const cost = item.landedCostPerUnit != null ? Number(item.landedCostPerUnit) : null
  const margin = cost && salePrice ? Math.round(((salePrice - cost) / cost) * 100) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            {item.productName || item.itemCode || "صنف بدون اسم"}
            <span className="mr-2 text-xs font-normal text-muted-foreground">({item.itemCode || "بدون كود"})</span>
          </DialogTitle>
        </DialogHeader>

        {/* Cost facts, read-only: what the file and the pricing produced. */}
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900/50 sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">الكمية</div>
            <div className="font-bold">{item.cartonCount ?? "—"} كرتون × {item.piecesPerCarton ?? "—"} = {item.quantity}</div>
          </div>
          <div>
            <div className="text-muted-foreground">كلفة القطعة</div>
            <div className="font-bold">{money(item.landedCostPerUnit)} د.ع</div>
          </div>
          <div>
            <div className="text-muted-foreground">كلفة الكرتون</div>
            <div className="font-bold">{money(item.landedCostPerCarton)} د.ع</div>
          </div>
          <div>
            <div className="text-muted-foreground">الربح على السعر المكتوب</div>
            <div className={cn("font-bold", margin == null ? "" : margin < 0 ? "text-rose-600" : "text-emerald-600")}>
              {margin == null ? "—" : `${margin}%`}
            </div>
          </div>
        </div>

        {/* Decision — one row of three, always visible so the state is obvious. */}
        <div className="flex gap-2">
          {([
            ["CREATE_NEW", "مادة جديدة"],
            ["LINK_EXISTING", "ربط بمادة موجودة"],
            ["SKIP", "تخطي"],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "default" : "outline"}
              className="flex-1"
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {mode === "LINK_EXISTING" && (
          <div className="flex flex-col gap-2">
            <Label className="text-xs">المادة الموجودة</Label>
            {linkedProduct && (
              <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-900 dark:bg-emerald-950/30">
                <span className="font-semibold text-emerald-800 dark:text-emerald-300">{linkedProduct.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setLinkedProduct(null)}>تغيير</Button>
              </div>
            )}
            {!linkedProduct && (
              <div className="relative">
                <Input placeholder="ابحث بالاسم أو رقم المادة..." value={search} onChange={(e) => setSearch(e.target.value)} />
                {search.trim().length >= 2 && (
                  <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-white shadow-lg dark:bg-slate-900">
                    {(productSearch.data ?? []).length === 0 && (
                      <div className="p-2 text-xs text-muted-foreground">لا توجد نتائج</div>
                    )}
                    {(productSearch.data ?? []).map((p) => (
                      <button
                        key={p.id}
                        className="flex w-full items-center gap-2 p-2 text-right text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => { setLinkedProduct({ id: p.id, name: p.name }); setSearch("") }}
                      >
                        <span className="flex-1">{p.name}</span>
                        <span className="text-xs text-muted-foreground">{p.itemNumber}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div>
              <Label className="text-xs">سعر البيع (للمعاينة — لا يُحدَّث تلقائياً على المادة الموجودة)</Label>
              <Input
                type="number"
                className="w-44"
                value={salePrice ?? ""}
                onChange={(e) => setSalePrice(Number(e.target.value) || undefined)}
              />
            </div>
          </div>
        )}

        {mode === "SKIP" && (
          <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            هذا الصنف ما راح يدخل فاتورة الشراء ولا المخزون.
          </p>
        )}

        {mode === "CREATE_NEW" && (
          <div className="flex flex-col gap-4">
            {/* Identity */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs">الاسم <span className="text-rose-500">*</span></Label>
                <Input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">رقم المادة</Label>
                <Input
                  value={draft.itemCode ?? ""}
                  onChange={(e) => setDraft({ ...draft, itemCode: e.target.value })}
                  className={codeClash ? "border-rose-400" : undefined}
                />
                {codeClash && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    مأخوذ من «{codeClash}» بنفس الأوردر — اكتب رقماً غيره
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">الباركود (فارغ = يتولّد تلقائياً)</Label>
                <Input value={draft.barcode ?? ""} onChange={(e) => setDraft({ ...draft, barcode: e.target.value })} />
              </div>
            </div>

            {/* Pricing */}
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20 sm:grid-cols-3">
              <div>
                <Label className="text-xs">سعر البيع بالجملة <span className="text-rose-500">*</span></Label>
                <Input
                  type="number"
                  value={salePrice ?? ""}
                  onChange={(e) => setSalePrice(Number(e.target.value) || undefined)}
                />
              </div>
              <div>
                <Label className="text-xs">قطع بالكرتون</Label>
                <Input
                  type="number"
                  value={draft.pcsPerCarton ?? ""}
                  onChange={(e) => setDraft({ ...draft, pcsPerCarton: Number(e.target.value) || undefined })}
                />
              </div>
              <div>
                <Label className="text-xs">موقع الخزن</Label>
                <Input
                  placeholder="مثال: رف A3"
                  value={draft.storageLocation ?? ""}
                  onChange={(e) => setDraft({ ...draft, storageLocation: e.target.value })}
                />
              </div>
            </div>

            {/* Tags */}
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">الفئة (اختر واحدة أو أكثر)</span>
              {cats.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  ماكو فئات معرّفة — أضفها من «إدارة الفئات» بأعلى صفحة المخزون.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {cats.map((c) => {
                    const sel = (draft.categoryTags ?? []).includes(c.name)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCategory(c.name)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-semibold transition",
                          sel
                            ? "border-indigo-500 bg-indigo-600 text-white"
                            : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-slate-900 dark:text-indigo-300",
                        )}
                      >
                        {c.name}
                      </button>
                    )
                  })}
                </div>
              )}
              {availableTypes.length > 0 && (
                <>
                  <span className="mt-1 text-xs font-semibold text-violet-600 dark:text-violet-400">النوع</span>
                  <div className="flex flex-wrap gap-2">
                    {availableTypes.map((t) => {
                      const sel = (draft.typeTags ?? []).includes(t)
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => toggleType(t)}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-semibold transition",
                            sel
                              ? "border-violet-500 bg-violet-600 text-white"
                              : "border-violet-200 bg-white text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-300",
                          )}
                        >
                          {t}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {/* Image */}
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border bg-slate-50 dark:bg-slate-800">
                {draft.imageUrl ? (
                  <img src={draft.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[11px] text-muted-foreground">لا صورة</span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label className="text-xs">صورة المادة</Label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>رفع صورة</Button>
                  {draft.imageUrl && (
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, imageUrl: "" })}>حذف الصورة</Button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = "" }}
                />
                <Input
                  placeholder="أو الصق رابط صورة"
                  value={draft.imageUrl?.startsWith("data:") ? "" : draft.imageUrl ?? ""}
                  onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                />
                {draft.imageUrl?.startsWith("data:") && (
                  <p className="text-[11px] text-muted-foreground">صورة مرفوعة من جهازك (مصغّرة تلقائياً).</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={save} disabled={decisionMutation.isPending}>
            {decisionMutation.isPending ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
