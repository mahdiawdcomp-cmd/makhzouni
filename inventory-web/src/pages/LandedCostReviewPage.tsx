import { useCallback, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardHeader, CardContent } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Label } from "../components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { cn } from "../utils/cn"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import {
  cancelLandedCostBatch,
  confirmLandedCostBatch,
  holdLandedCostBatch,
  markLandedCostBatchArrived,
  getBranches,
  getLandedCostBatch,
  getCatalogCategories,
  setLandedCostItemDecision,
  type LandedCostItem,
} from "../api/endpoints"
import { useCustomers } from "../hooks/useCustomers"
import { LandedCostItemPanel } from "../components/LandedCostItemPanel"

function money(n: number | null | undefined) {
  if (n == null) return "—"
  return Math.round(n).toLocaleString("en-US")
}

function imgSrc(url?: string | null) {
  return url || null
}

/** One compact row in the review table. Details live in the side panel. */
function ItemRow({ item, highlighted, stillDuplicated, onOpen }: {
  item: LandedCostItem
  highlighted?: boolean
  stillDuplicated?: boolean
  onOpen: () => void
}) {
  const image = imgSrc(item.product?.thumbnailUrl ?? item.product?.imageUrl ?? item.newProductDraft?.imageUrl)
  // Mirrors the server: the saved draft's code wins over the Excel one.
  const effectiveCode = (item.newProductDraft?.itemCode || item.itemCode || "").trim()
  const displayName = item.newProductDraft?.name || item.product?.name || item.productName
  const tags = [...(item.newProductDraft?.categoryTags ?? []), ...(item.newProductDraft?.typeTags ?? [])]

  const state =
    item.action === "SKIP" ? { label: "متخطى", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" }
    : item.action === "LINK_EXISTING" ? { label: "مرتبط", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" }
    : item.action === "CREATE_NEW" ? { label: "مادة جديدة", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" }
    : { label: "يحتاج قرار", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" }

  return (
    <tr
      id={`lc-item-${item.id}`}
      onClick={onOpen}
      className={cn(
        "cursor-pointer border-t transition hover:bg-slate-50 dark:hover:bg-slate-800/60",
        highlighted && "bg-amber-50 ring-2 ring-amber-400 dark:bg-amber-900/20",
        stillDuplicated && "bg-rose-50 dark:bg-rose-950/20",
      )}
    >
      <td className="p-2">
        <div className="grid h-11 w-11 place-items-center overflow-hidden rounded-md border bg-slate-50 dark:bg-slate-800">
          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <span className="text-[9px] text-muted-foreground">لا صورة</span>}
        </div>
      </td>
      <td className="p-2">
        <div className="font-semibold">{displayName || "بدون اسم"}</div>
        <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          <span>{effectiveCode || "بدون كود"}</span>
          {effectiveCode && effectiveCode !== item.itemCode && <span>(بالملف: {item.itemCode})</span>}
          {stillDuplicated && <span className="font-bold text-rose-600">رقم مكرر</span>}
        </div>
        {tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full bg-indigo-50 px-1.5 py-px text-[10px] text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">{t}</span>
            ))}
          </div>
        )}
      </td>
      <td className="p-2 text-center text-xs">
        <div className="font-semibold">{item.cartonCount ?? "—"} كرتون</div>
        <div className="text-muted-foreground">{item.quantity} قطعة</div>
      </td>
      <td className="p-2 text-center text-xs">
        <div className="font-semibold">{money(item.landedCostPerUnit)}</div>
        <div className="text-muted-foreground">الكرتون {money(item.landedCostPerCarton)}</div>
      </td>
      <td className="p-2 text-center">
        {item.confirmedSalePrice != null ? (
          <span className="font-bold text-emerald-700 dark:text-emerald-400">{money(item.confirmedSalePrice)}</span>
        ) : item.action === "SKIP" ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="text-xs font-semibold text-amber-600">غير مسعّر</span>
        )}
      </td>
      <td className="p-2 text-center">
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", state.cls)}>{state.label}</span>
      </td>
      <td className="p-2 text-left">
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onOpen() }}>تفاصيل</Button>
      </td>
    </tr>
  )
}

export function LandedCostReviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const batchId = id!

  const batchQuery = useQuery({ queryKey: ["landed-cost-batch", batchId], queryFn: () => getLandedCostBatch(batchId) })
  const branchesQuery = useQuery({ queryKey: ["branches-active"], queryFn: () => getBranches({ isActive: true }) })
  const { customersQuery } = useCustomers(true)

  const queryClient = useQueryClient()
  const [supplierCustomerId, setSupplierCustomerId] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [paymentType, setPaymentType] = useState<"CASH" | "CREDIT" | "PARTIAL">("CREDIT")
  const [paidAmount, setPaidAmount] = useState(0)
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof confirmLandedCostBatch>> | null>(null)
  // Default «وصلت»: that is what every confirm before this one meant, so an
  // admin who does not read the new question gets exactly the old behaviour.
  const [arrived, setArrived] = useState(true)
  const [expectedAt, setExpectedAt] = useState("")

  const confirmMutation = useMutation({
    mutationFn: () => confirmLandedCostBatch(batchId, { supplierCustomerId, warehouseId: warehouseId || undefined, paymentType, paidAmount }),
    onSuccess: (result) => {
      setSummary(result)
      toast({ title: "تم إنشاء فاتورة الشراء", description: `رقم الفاتورة: ${result.invoiceNumber}` })
    },
    onError: (err: unknown) => toast({ title: "تعذّر إنشاء فاتورة الشراء", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const holdMutation = useMutation({
    mutationFn: () => holdLandedCostBatch(batchId, {
      supplierCustomerId, warehouseId: warehouseId || undefined, paymentType, paidAmount,
      expectedAt: expectedAt || null,
    }),
    onSuccess: (result) => {
      toast({
        title: "انحفظت كبضاعة قادمة",
        description: `${result.incomingCount} مادة صارت تنعرض للزبائن للحجز. ما انكتبت فاتورة ولا دخل مخزون.`,
      })
      void queryClient.invalidateQueries({ queryKey: ["landed-cost-batch", batchId] })
    },
    onError: (err: unknown) => toast({ title: "تعذّر الحفظ", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const arrivedMutation = useMutation({
    mutationFn: () => markLandedCostBatchArrived(batchId),
    onSuccess: (result) => {
      setSummary(result)
      toast({ title: "وصلت الشحنة", description: `رقم فاتورة الشراء: ${result.invoiceNumber}` })
    },
    onError: (err: unknown) => toast({ title: "تعذّر تسجيل الوصول", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const [confirmCancel, setConfirmCancel] = useState(false)
  const [onlyUnresolved, setOnlyUnresolved] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "CREATE_NEW" | "LINK_EXISTING" | "SKIP">("ALL")
  const [search, setSearch] = useState("")
  const [panelItemId, setPanelItemId] = useState<string | null>(null)
  const [bulkCategoryTags, setBulkCategoryTags] = useState<string[]>([])
  const [bulkTypeTags, setBulkTypeTags] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const cancelMutation = useMutation({
    mutationFn: () => cancelLandedCostBatch(batchId),
    onSuccess: () => navigate("/inventory/landed-cost"),
    onError: (err: unknown) => toast({ title: "تعذّر إلغاء الدفعة", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const catalogCatsQuery = useQuery({ queryKey: ["catalog-categories"], queryFn: getCatalogCategories })
  const catalogCats = useMemo(() => catalogCatsQuery.data ?? [], [catalogCatsQuery.data])
  const batch = batchQuery.data
  const unresolvedItems = useMemo(() => (batch?.items ?? []).filter((it) => it.action === "PENDING"), [batch])
  const unresolvedCount = unresolvedItems.length
  // itemNumber is unique, so two rows asking to CREATE the same code can never
  // both become products. Surfacing it here — instead of letting the server
  // fail on the day the container lands — is the whole point of this screen.
  const duplicateNewCodes = useMemo(() => {
    const owners = new Map<string, string[]>()
    for (const it of batch?.items ?? []) {
      if (it.action !== "CREATE_NEW") continue
      const code = (it.newProductDraft?.itemCode ?? it.itemCode ?? "").trim()
      if (!code) continue
      owners.set(code, [...(owners.get(code) ?? []), it.productName || code])
    }
    return [...owners.entries()].filter(([, names]) => names.length > 1)
  }, [batch])
  const duplicateCodeSet = useMemo(() => new Set(duplicateNewCodes.map(([code]) => code)), [duplicateNewCodes])
  const codeTakenBy = useCallback(
    (code: string, exceptItemId: string) => {
      const wanted = code.trim()
      if (!wanted) return null
      const other = (batch?.items ?? []).find(
        (it) =>
          it.id !== exceptItemId &&
          it.action === "CREATE_NEW" &&
          (it.newProductDraft?.itemCode || it.itemCode || "").trim() === wanted,
      )
      return other ? other.productName || wanted : null
    },
    [batch],
  )
  // Types offered in the bulk picker follow the chosen categories, same rule as
  // the per-item panel and the inventory page.
  const bulkTypes = useMemo(
    () => [...new Set(catalogCats.filter((c) => bulkCategoryTags.includes(c.name)).flatMap((c) => c.types))].sort(),
    [catalogCats, bulkCategoryTags],
  )

  const counts = useMemo(() => {
    const all = batch?.items ?? []
    return {
      all: all.length,
      PENDING: all.filter((it) => it.action === "PENDING").length,
      CREATE_NEW: all.filter((it) => it.action === "CREATE_NEW").length,
      LINK_EXISTING: all.filter((it) => it.action === "LINK_EXISTING").length,
      SKIP: all.filter((it) => it.action === "SKIP").length,
    }
  }, [batch])

  const visibleItems = useMemo(() => {
    let list = batch?.items ?? []
    // `onlyUnresolved` predates the filter chips and is still driven by the
    // banner's own toggle, so it stays as an override on top of them.
    if (onlyUnresolved) list = list.filter((it) => it.action === "PENDING")
    else if (filter !== "ALL") list = list.filter((it) => it.action === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((it) => {
        const name = (it.newProductDraft?.name || it.product?.name || it.productName || "").toLowerCase()
        const code = (it.newProductDraft?.itemCode || it.itemCode || "").toLowerCase()
        return name.includes(q) || code.includes(q)
      })
    }
    return list
  }, [batch, onlyUnresolved, filter, search])

  function goToItem(itemId: string) {
    setHighlightId(itemId)
    setOnlyUnresolved(false)
    setFilter("ALL")
    setSearch("")
    requestAnimationFrame(() => {
      document.getElementById(`lc-item-${itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  // Bulk tags: a China order is usually one family of goods, so the tags are
  // chosen ONCE and stamped on every row you are creating as a new product.
  async function applyTagsToAll() {
    const targets = (batch?.items ?? []).filter((it) => it.action === "CREATE_NEW")
    if (targets.length === 0) {
      toast({ title: "ماكو مواد جديدة", description: "التاكات تنطبق على المواد الي راح تنشئها فقط", variant: "destructive" })
      return
    }
    setBulkBusy(true)
    let done = 0
    try {
      for (const it of targets) {
        await setLandedCostItemDecision(batchId, it.id, {
          action: "CREATE_NEW",
          confirmedSalePrice: it.confirmedSalePrice,
          newProductDraft: {
            ...(it.newProductDraft ?? {}),
            categoryTags: bulkCategoryTags,
            typeTags: bulkTypeTags,
            category: bulkCategoryTags[0] ?? it.newProductDraft?.category,
          },
        })
        done++
      }
      toast({ title: "انطبقت التاكات", description: `${done} مادة` })
    } catch (err) {
      toast({
        title: "توقف التطبيق",
        description: `${apiErrorMessage(err)} — انطبقت على ${done} من ${targets.length}`,
        variant: "destructive",
      })
    } finally {
      setBulkBusy(false)
      void queryClient.invalidateQueries({ queryKey: ["landed-cost-batch", batchId] })
    }
  }
  const locked = batch?.status === "PURCHASE_INVOICE_CREATED" || batch?.status === "CANCELLED"
  // Held for arrival: the decisions are made and stored, so what is left is
  // one button on the day the container lands — not the whole form again.
  const awaiting = batch?.status === "AWAITING_ARRIVAL"

  if (batchQuery.isLoading) return <div className="p-6">جاري التحميل...</div>
  if (!batch) return <div className="p-6">الدفعة غير موجودة</div>

  if (summary) {
    return (
      <div className="mx-auto max-w-2xl p-6" dir="rtl">
        <Card>
          <CardHeader><span className="font-semibold">تم إنشاء فاتورة الشراء بنجاح</span></CardHeader>
          <CardContent className="flex flex-col gap-2 p-5 text-sm">
            <div>رقم الفاتورة: <b>{summary.invoiceNumber}</b></div>
            <div>عدد الأصناف المرتبطة بمواد موجودة: <b>{summary.linkedCount}</b></div>
            <div>عدد المواد الجديدة التي تم إنشاؤها: <b>{summary.createdCount}</b></div>
            <div>عدد الأصناف التي تم تخطيها: <b>{summary.skippedCount}</b></div>
            <div>إجمالي الكمية المضافة للمخزون: <b>{summary.totalStockAdded}</b></div>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => navigate(`/invoices/${summary.purchaseInvoiceId}`)}>عرض فاتورة الشراء</Button>
              <Button variant="outline" onClick={() => navigate("/inventory/landed-cost")}>العودة لقائمة الاستيرادات</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6" dir="rtl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">مراجعة الأوردر المسعّر</h1>
        {!locked && <Button variant="ghost" onClick={() => setConfirmCancel(true)}>إلغاء الدفعة</Button>}
      </div>

      {duplicateNewCodes.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/25 dark:text-rose-300">
          <div className="font-semibold">رقم مادة مكرر — لا يمكن إنشاء مادتين بنفس الرقم:</div>
          {duplicateNewCodes.map(([code, names]) => (
            <div key={code}>
              «{code}» مطلوب لـ {names.length} أصناف: {names.join("، ")}
            </div>
          ))}
          <div className="text-xs">
            غيّر رقم المادة في أحدها، أو اربطه بمادة موجودة، أو تخطّه — وإلا سيفشل إنشاء فاتورة الشراء.
          </div>
        </div>
      )}
      {unresolvedCount > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <div>
            يوجد {unresolvedCount} صنف بحاجة لقرار (ربط بمادة موجودة / إنشاء مادة جديدة / تخطي) قبل إنشاء فاتورة الشراء.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {unresolvedItems.slice(0, 20).map((it) => (
              <Button key={it.id} size="sm" variant="outline" onClick={() => goToItem(it.id)}>
                {it.productName || it.itemCode || "بدون اسم"}
              </Button>
            ))}
            {unresolvedCount > 20 && <span className="text-xs">و {unresolvedCount - 20} صنف آخر</span>}
          </div>
          <div>
            <Button size="sm" variant="ghost" onClick={() => setOnlyUnresolved((v) => !v)}>
              {onlyUnresolved ? "أظهر كل الأصناف" : "أظهر غير المحسومة فقط"}
            </Button>
          </div>
        </div>
      )}

      {/* Bulk tags — chosen once, stamped on every new product in the order. */}
      {!locked && (
        <Card>
          <CardHeader className="pb-0"><span className="text-sm font-semibold">تاكات لكل المواد الجديدة</span></CardHeader>
          <CardContent className="flex flex-col gap-2 p-4">
            {catalogCats.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                ماكو فئات معرّفة — أضفها من «إدارة الفئات» بأعلى صفحة المخزون.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {catalogCats.map((c) => {
                    const sel = bulkCategoryTags.includes(c.name)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          const next = sel ? bulkCategoryTags.filter((t) => t !== c.name) : [...bulkCategoryTags, c.name]
                          const validTypes = new Set(catalogCats.filter((x) => next.includes(x.name)).flatMap((x) => x.types))
                          setBulkCategoryTags(next)
                          setBulkTypeTags(bulkTypeTags.filter((t) => validTypes.has(t)))
                        }}
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
                {bulkTypes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {bulkTypes.map((t) => {
                      const sel = bulkTypeTags.includes(t)
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setBulkTypeTags(sel ? bulkTypeTags.filter((x) => x !== t) : [...bulkTypeTags, t])}
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
                )}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={bulkBusy || bulkCategoryTags.length + bulkTypeTags.length === 0 || counts.CREATE_NEW === 0}
                    onClick={() => void applyTagsToAll()}
                  >
                    {bulkBusy ? "جاري التطبيق..." : `طبّقها على ${counts.CREATE_NEW} مادة جديدة`}
                  </Button>
                  <span className="text-[11px] text-muted-foreground">تستبدل تاكات كل مادة جديدة بالمختار فوق.</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          {/* Toolbar: what is left to do, and how to find it. */}
          <div className="flex flex-wrap items-center gap-2">
            {([
              ["ALL", `الكل (${counts.all})`],
              ["PENDING", `يحتاج قرار (${counts.PENDING})`],
              ["CREATE_NEW", `جديد (${counts.CREATE_NEW})`],
              ["LINK_EXISTING", `مرتبط (${counts.LINK_EXISTING})`],
              ["SKIP", `متخطى (${counts.SKIP})`],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={!onlyUnresolved && filter === value ? "default" : "outline"}
                onClick={() => { setFilter(value); setOnlyUnresolved(false) }}
              >
                {label}
              </Button>
            ))}
            <Input
              className="ms-auto w-56"
              placeholder="ابحث بالاسم أو رقم المادة..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-muted-foreground dark:bg-slate-800">
                <tr>
                  <th className="p-2"></th>
                  <th className="p-2 text-right">المادة</th>
                  <th className="p-2">الكمية</th>
                  <th className="p-2">الكلفة</th>
                  <th className="p-2">سعر البيع</th>
                  <th className="p-2">الحالة</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    highlighted={highlightId === item.id}
                    stillDuplicated={duplicateCodeSet.has((item.newProductDraft?.itemCode || item.itemCode || "").trim())}
                    onOpen={() => setPanelItemId(item.id)}
                  />
                ))}
                {visibleItems.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">ماكو أصناف بهذا الفلتر</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <LandedCostItemPanel
        item={(batch.items ?? []).find((it) => it.id === panelItemId) ?? null}
        batchId={batchId}
        open={panelItemId !== null}
        onOpenChange={(o) => { if (!o) setPanelItemId(null) }}
        codeTakenBy={codeTakenBy}
      />

      {awaiting && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-sky-800">🚢 هذي الشحنة بالطريق</p>
              <p className="mt-1 text-sm text-slate-600">
                ما انكتبت فاتورة ولا دخل مخزون. موادها تنعرض للزبائن بـ«البضاعة القادمة» ويقدرون يحجزون عليها.
                {batch?.expectedArrivalAt && ` متوقع توصل ${new Date(batch.expectedArrivalAt).toLocaleDateString("ar-IQ")}.`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                إذا وصلت مجزّأة، تكدر تسجّل كل مادة لحالها من صفحة الكتلوك ← البضاعة القادمة.
              </p>
            </div>
            <Button
              className="shrink-0"
              // A held shipment can still carry a clashing item number (the row
              // decisions stay editable while it's in transit) — blocking here
              // beats failing halfway through receiving the container.
              disabled={arrivedMutation.isPending || duplicateNewCodes.length > 0 || unresolvedCount > 0}
              onClick={() => arrivedMutation.mutate()}
            >
              {arrivedMutation.isPending ? "جاري الإدخال..." : "وصلت الشحنة كلها"}
            </Button>
          </CardContent>
        </Card>
      )}

      {!locked && !awaiting && (
        <Card>
          <CardHeader><span className="font-semibold">إنشاء فاتورة شراء من هذا الأوردر</span></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-4">
            <div>
              <Label>المورّد (كزبون)</Label>
              <Select value={supplierCustomerId} onValueChange={setSupplierCustomerId}>
                <SelectTrigger><SelectValue placeholder="اختر المورّد" /></SelectTrigger>
                <SelectContent>
                  {(customersQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المخزن (اختياري)</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="افتراضي" /></SelectTrigger>
                <SelectContent>
                  {(branchesQuery.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع الدفع</Label>
              <Select value={paymentType} onValueChange={(v) => setPaymentType(v as typeof paymentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">نقد كامل</SelectItem>
                  <SelectItem value="CREDIT">آجل</SelectItem>
                  <SelectItem value="PARTIAL">دفع جزئي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المبلغ المدفوع</Label>
              <Input type="number" value={paidAmount} onChange={(e) => setPaidAmount(Number(e.target.value) || 0)} />
            </div>
            <div className="sm:col-span-4">
              {/* The question that has to come before the invoice. Confirming a
                  container still at sea used to put stock on the shelf nobody
                  could pick, and let the catalog sell it. */}
              <Label>البضاعة وصلت؟</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:max-w-md">
                {([
                  { v: true, title: "وصلت", desc: "تنكتب فاتورة الشراء ويدخل المخزون هسه" },
                  { v: false, title: "ما وصلت بعد", desc: "ولا شي ينكتب — تروح للبضاعة القادمة" },
                ] as const).map((o) => (
                  <button key={String(o.v)} type="button" onClick={() => setArrived(o.v)}
                    className={cn(
                      "rounded-xl border-2 p-3 text-right transition",
                      arrived === o.v ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300",
                    )}>
                    <p className={cn("text-sm font-bold", arrived === o.v ? "text-blue-700" : "text-slate-700")}>{o.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{o.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {!arrived && (
              <div className="sm:col-span-2">
                <Label>متوقع يوصل (اختياري)</Label>
                <Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} dir="ltr" />
                <p className="mt-1 text-[11px] text-slate-500">
                  يظهر للزبون على بطاقة البضاعة القادمة. اتركه فارغ إذا ما تريد تلتزم بتاريخ.
                </p>
              </div>
            )}

            <div className="sm:col-span-4">
              <Button
                disabled={!supplierCustomerId || unresolvedCount > 0 || duplicateNewCodes.length > 0 || confirmMutation.isPending || holdMutation.isPending}
                onClick={() => (arrived ? confirmMutation : holdMutation).mutate()}
              >
                {arrived
                  ? (confirmMutation.isPending ? "جاري الإنشاء..." : "إنشاء فاتورة شراء من هذا الأوردر")
                  : (holdMutation.isPending ? "جاري الحفظ..." : "احفظها كبضاعة قادمة")}
              </Button>
              {!arrived && (
                <p className="mt-2 text-xs text-slate-500">
                  ما تنكتب فاتورة ولا يدخل مخزون. يوم توصل تضغط «وصلت» ويصير كل شي دفعة وحدة.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="إلغاء هذه الدفعة؟"
        description="سيتم إلغاء الأوردر المسعّر وكل القرارات اللي سويتها عليه، ولا يمكن التراجع عن ذلك."
        confirmLabel="إلغاء الدفعة"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  )
}
