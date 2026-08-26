import { useMemo, useRef, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Receipt, RotateCcw, Trash2, X } from "lucide-react"
import { getCustomerProductHistory, getInvoices } from "../api/endpoints"
import { useCustomers } from "../hooks/useCustomers"
import { useProducts } from "../hooks/useProducts"
import { useCreateInvoice, useInvoice } from "../hooks/useInvoices"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { NumericInput } from "../components/ui/NumericInput"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { apiErrorMessage } from "../utils/apiError"
import { formatDate } from "../utils/date"
import { fmt } from "../utils/fmt"
import { sortCustomersByRelevance, sortProductsByRelevance } from "../utils/search"
import { UNIT_LABELS, unitToPieces, visibleUnits, type InvoiceUnit } from "../utils/units"
import type { Customer, Product } from "../types/api"

const ALL_UNITS: InvoiceUnit[] = ["PIECE", "DOZEN", "BOX", "CARTON"]

function isInvoiceUnit(value: string): value is InvoiceUnit {
  return (ALL_UNITS as string[]).includes(value)
}

function placeholderProduct(productId: string, name: string, itemNumber: string, salePrice: number): Product {
  return {
    id: productId,
    itemNumber,
    name,
    openingBalancePcs: 0,
    cartonsAvailable: 0,
    pcsPerCarton: 1,
    purchasePrice: 0,
    salePrice,
    retailPrice: salePrice,
    minStock: 0,
  }
}

interface ReturnLine {
  id: string
  product: Product
  warehouseId?: string
  warehouseName?: string
  unit: InvoiceUnit
  quantity: number
  unitPrice: number
  maxQuantity?: number
  sourceNote?: string
}

export function SalesReturnsPage() {
  usePageTitle("مرتجع المبيعات")
  const queryClient = useQueryClient()
  const clientRequestIdRef = useRef(crypto.randomUUID())

  const { customersQuery } = useCustomers()
  const { productsQuery } = useProducts()
  const customers = customersQuery.data ?? []
  const products = productsQuery.data ?? []

  // ── Customer picker (searchable, not a <select>) ──────────────────────────
  const [customerQuery, setCustomerQuery] = useState("")
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerListOpen, setCustomerListOpen] = useState(false)
  const customerSuggestions = useMemo(
    () => sortCustomersByRelevance(customers, customerQuery).slice(0, 8),
    [customers, customerQuery],
  )

  function pickCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setCustomerQuery(customer.name)
    setCustomerListOpen(false)
    setOriginalInvoiceId(undefined)
    setOriginalInvoiceQuery("")
    setLines([])
  }

  // ── Original sale invoice (optional) — lets return lines be pulled straight
  // from what was actually sold, with the backend capping quantity to it. ────
  const [originalInvoiceId, setOriginalInvoiceId] = useState<string | undefined>()
  const [originalInvoiceQuery, setOriginalInvoiceQuery] = useState("")
  const originalInvoicesQuery = useQuery({
    queryKey: ["invoices", "sales-return-source", selectedCustomer?.id],
    queryFn: () => getInvoices({ customerId: selectedCustomer!.id, type: "SALE", status: "ACTIVE", limit: 50 }),
    enabled: Boolean(selectedCustomer?.id),
  })
  const originalInvoiceOptions = (originalInvoicesQuery.data ?? []).filter((inv) =>
    !originalInvoiceQuery.trim() || inv.invoiceNumber.toLowerCase().includes(originalInvoiceQuery.trim().toLowerCase())
  )
  const originalInvoiceDetail = useInvoice(originalInvoiceId)

  function importAllFromOriginal() {
    const items = originalInvoiceDetail.data?.items ?? []
    if (!items.length) return
    const imported: ReturnLine[] = items.map((item) => ({
      id: crypto.randomUUID(),
      product: products.find((p) => p.id === item.productId)
        ?? placeholderProduct(item.productId, item.productName ?? "مادة محذوفة", item.itemNumber ?? "—", item.unitPrice),
      warehouseId: item.warehouseId,
      warehouseName: item.warehouseName ?? undefined,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      maxQuantity: item.quantity,
      sourceNote: `من الفاتورة ${originalInvoiceDetail.data?.invoiceNumber}`,
    }))
    setLines((prev) => [...prev, ...imported])
  }

  // ── Item lines (multi-line, like a real invoice) ───────────────────────────
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [productQuery, setProductQuery] = useState("")
  const [productListOpen, setProductListOpen] = useState(false)
  const productSuggestions = useMemo(
    // A return puts stock BACK — the item is usually the sold-out one.
    () => sortProductsByRelevance(products, productQuery, { availabilityFirst: false }).slice(0, 8),
    [products, productQuery],
  )

  async function addProductLine(product: Product) {
    const id = crypto.randomUUID()
    setLines((prev) => [...prev, { id, product, unit: "PIECE", quantity: 1, unitPrice: product.salePrice, sourceNote: selectedCustomer ? "جاري التحقق من سجل الشراء..." : undefined }])
    setProductQuery("")
    setProductListOpen(false)
    if (!selectedCustomer) return
    try {
      const history = await getCustomerProductHistory(selectedCustomer.id, product.id)
      if (!history || history.timesSold === 0) {
        setLines((prev) => prev.map((l) => l.id === id ? { ...l, sourceNote: "⚠ لم يشترِ هذا الزبون هذه المادة من قبل" } : l))
        return
      }
      const last = history.last
      const soldUnit = last && isInvoiceUnit(last.unit) ? last.unit : "PIECE"
      const note = last
        ? `بيعت ${fmt(history.timesSold)}× لهذا الزبون · آخر سعر ${fmt(last.unitPrice)}/${UNIT_LABELS[soldUnit]} · إجمالي الكمية ${fmt(history.totalQuantityPieces)} قطعة`
        : `بيعت ${fmt(history.timesSold)}× لهذا الزبون`
      setLines((prev) => prev.map((l) => l.id === id
        ? {
            ...l,
            unit: soldUnit,
            unitPrice: last ? last.unitPrice : l.unitPrice,
            warehouseId: last?.warehouseId ?? undefined,
            sourceNote: note,
          }
        : l))
    } catch {
      setLines((prev) => prev.map((l) => l.id === id ? { ...l, sourceNote: undefined } : l))
    }
  }

  function updateLine(id: string, patch: Partial<ReturnLine>) {
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l))
  }
  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  const total = lines.reduce((sum, l) => sum + Math.max(0, l.quantity) * Math.max(0, l.unitPrice), 0)

  // ── Save ────────────────────────────────────────────────────────────────
  const [notes, setNotes] = useState("")
  const createMutation = useCreateInvoice()
  const canSave = Boolean(selectedCustomer) && lines.length > 0 && lines.every((l) => l.quantity > 0 && l.unitPrice >= 0)

  function save() {
    if (!selectedCustomer || !canSave) return
    createMutation.mutate({
      customerId: selectedCustomer.id,
      type: "SALES_RETURN",
      clientRequestId: clientRequestIdRef.current,
      originalInvoiceId,
      discount: 0,
      tax: 0,
      paidAmount: 0,
      paymentType: "CREDIT",
      notes: notes.trim() || undefined,
      items: lines.map((l) => ({
        productId: l.product.id,
        warehouseId: l.warehouseId,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      })),
    }, {
      onSuccess: () => {
        clientRequestIdRef.current = crypto.randomUUID()
        setLines([])
        setNotes("")
        setOriginalInvoiceId(undefined)
        setOriginalInvoiceQuery("")
        void queryClient.invalidateQueries({ queryKey: ["customers"] })
      },
      onError: () => {
        clientRequestIdRef.current = crypto.randomUUID()
      },
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl bg-gradient-to-l from-rose-500 to-rose-600 px-4 py-3 text-white shadow-sm">
        <RotateCcw className="h-6 w-6 shrink-0" />
        <div>
          <h1 className="text-lg font-bold">مرتجع مبيعات</h1>
          <p className="text-xs opacity-85">يرجع المخزون وينقص حساب الزبون — يدعم عدة أصناف بنفس المرتجع</p>
        </div>
      </div>

      {/* Customer + original invoice */}
      <Card>
        <CardHeader><CardTitle>الزبون والفاتورة الأصلية</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <label className="text-xs font-medium text-slate-500">الزبون</label>
            <Input
              className="mt-1 h-9"
              placeholder="ابحث بالاسم أو رقم الهاتف..."
              value={customerQuery}
              onChange={(e) => { setCustomerQuery(e.target.value); setSelectedCustomer(null); setCustomerListOpen(true) }}
              onFocus={() => { if (customerQuery && !selectedCustomer) setCustomerListOpen(true) }}
              onBlur={() => window.setTimeout(() => setCustomerListOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter" && customerSuggestions[0]) pickCustomer(customerSuggestions[0]) }}
            />
            {customerListOpen && !selectedCustomer && customerQuery ? (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-white p-1 shadow dark:border-slate-700 dark:bg-slate-950">
                {customerSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-right text-sm hover:bg-slate-100 dark:hover:bg-slate-900"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickCustomer(c)}
                  >
                    <span className="flex-1 truncate">{c.name} — {c.phone}</span>
                  </button>
                ))}
                {customerSuggestions.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-slate-400">لا يوجد زبون مطابق</div>
                )}
              </div>
            ) : null}
          </div>

          {selectedCustomer && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-500">الفاتورة الأصلية (اختياري — تحدد أقصى كمية للإرجاع تلقائياً)</label>
                {originalInvoiceId && (
                  <button type="button" className="flex items-center gap-1 text-xs text-rose-600 hover:underline" onClick={() => { setOriginalInvoiceId(undefined); setOriginalInvoiceQuery("") }}>
                    <X className="h-3 w-3" /> إلغاء الربط
                  </button>
                )}
              </div>
              {!originalInvoiceId ? (
                <div className="mt-1 max-w-sm">
                  <Input
                    className="h-9"
                    placeholder="ابحث برقم الفاتورة..."
                    value={originalInvoiceQuery}
                    onChange={(e) => setOriginalInvoiceQuery(e.target.value)}
                  />
                  <div className="mt-1 max-h-40 overflow-auto rounded-md border dark:border-slate-700">
                    {originalInvoicesQuery.isLoading ? (
                      <div className="px-2 py-1.5 text-sm text-slate-400">جاري التحميل...</div>
                    ) : originalInvoiceOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-slate-400">لا توجد فواتير بيع لهذا الزبون</div>
                    ) : originalInvoiceOptions.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 border-b px-2 py-1.5 text-right text-sm last:border-0 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-900"
                        onClick={() => setOriginalInvoiceId(inv.id)}
                      >
                        <span className="flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5 text-slate-400" /> #{inv.invoiceNumber}</span>
                        <span className="text-slate-400">{formatDate(inv.date)} · {fmt(inv.totalAmount)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 dark:border-sky-800 dark:bg-sky-950/30">
                  <span className="text-sm font-medium text-sky-800 dark:text-sky-300">
                    <Receipt className="inline h-3.5 w-3.5 ml-1" />
                    #{originalInvoiceDetail.data?.invoiceNumber} — {fmt(originalInvoiceDetail.data?.totalAmount ?? 0)}
                  </span>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!originalInvoiceDetail.data?.items?.length} onClick={importAllFromOriginal}>
                    <Plus className="h-3.5 w-3.5" /> استيراد كل الأصناف
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader><CardTitle>الأصناف المرتجعة</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Input
              className="h-9"
              placeholder="ابحث عن مادة لإضافتها..."
              value={productQuery}
              onChange={(e) => { setProductQuery(e.target.value); setProductListOpen(true) }}
              onFocus={() => { if (productQuery) setProductListOpen(true) }}
              onBlur={() => window.setTimeout(() => setProductListOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter" && productSuggestions[0]) void addProductLine(productSuggestions[0]) }}
            />
            {productListOpen && productQuery ? (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-white p-1 shadow dark:border-slate-700 dark:bg-slate-950">
                {productSuggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-right text-sm hover:bg-slate-100 dark:hover:bg-slate-900"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void addProductLine(p)}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-400">{p.itemNumber}</span>
                  </button>
                ))}
                {productSuggestions.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-slate-400">لا توجد مادة مطابقة</div>
                )}
              </div>
            ) : null}
          </div>

          {lines.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-slate-500 dark:border-slate-700">
              لا يوجد أصناف بعد. ابحث عن مادة فوق، أو اربط فاتورة أصلية واستورد أصنافها.
            </div>
          ) : (
            <div className="overflow-x-auto [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1.5">
              <Table>
                <THead>
                  <TR>
                    <TH>المادة</TH>
                    <TH>المخزن</TH>
                    <TH>الوحدة</TH>
                    <TH>العدد</TH>
                    <TH>سعر الإرجاع</TH>
                    <TH>الإجمالي</TH>
                    <TH>حذف</TH>
                  </TR>
                </THead>
                <TBody>
                  {lines.map((line) => {
                    const overMax = line.maxQuantity !== undefined && unitToPieces(line.unit, line.quantity, line.product) > unitToPieces(line.unit, line.maxQuantity, line.product)
                    return (
                      <TR key={line.id}>
                        <TD>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{line.product.name}</span>
                            {line.sourceNote && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{line.sourceNote}</span>}
                            {overMax && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">⚠ أكثر من المباع ({line.maxQuantity})</span>}
                          </div>
                        </TD>
                        <TD>
                          {(line.product.warehouseStocks ?? []).length > 1 ? (
                            <select
                              className="h-7 w-28 rounded-md border bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                              value={line.warehouseId ?? ""}
                              onChange={(e) => {
                                const wsId = e.target.value || undefined
                                const wsName = wsId ? (line.product.warehouseStocks ?? []).find((ws) => ws.warehouseId === wsId)?.warehouse.name : undefined
                                updateLine(line.id, { warehouseId: wsId, warehouseName: wsName })
                              }}
                            >
                              <option value="">المحل (افتراضي)</option>
                              {(line.product.warehouseStocks ?? []).map((ws) => (
                                <option key={ws.warehouseId} value={ws.warehouseId}>{ws.warehouse.name}</option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs text-slate-500">{line.warehouseName ?? "المحل"}</span>
                          )}
                        </TD>
                        <TD>
                          <select
                            className="h-7 w-24 rounded-md border bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                            value={line.unit}
                            onChange={(e) => { if (isInvoiceUnit(e.target.value)) updateLine(line.id, { unit: e.target.value }) }}
                          >
                            {Array.from(new Set([...visibleUnits(line.product), line.unit])).map((u) => (
                              <option key={u} value={u}>{UNIT_LABELS[u]}</option>
                            ))}
                          </select>
                        </TD>
                        <TD>
                          <NumericInput
                            className="h-7 w-16 text-xs"
                            decimal={false}
                            value={line.quantity}
                            onValueChange={(n) => updateLine(line.id, { quantity: n })}
                          />
                        </TD>
                        <TD>
                          <NumericInput
                            className="h-7 w-24 text-xs"
                            value={line.unitPrice}
                            onValueChange={(n) => updateLine(line.id, { unitPrice: n })}
                          />
                        </TD>
                        <TD className="font-semibold">{fmt(line.quantity * line.unitPrice)}</TD>
                        <TD>
                          <Button variant="ghost" size="sm" onClick={() => removeLine(line.id)}>
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </Button>
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notes + total + save */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <Input className="h-9" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات المرتجع (اختياري)" />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-950/30">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">إجمالي المرتجع</span>
            <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{fmt(total)}</span>
          </div>
          <Button disabled={!canSave || createMutation.isPending} onClick={save}>
            <RotateCcw className="h-4 w-4" /> {createMutation.isPending ? "..." : "حفظ مرتجع المبيعات"}
          </Button>
          {createMutation.isSuccess ? <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">تم حفظ المرتجع وتحديث المخزون والحساب.</div> : null}
          {createMutation.isError ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{apiErrorMessage(createMutation.error, "تعذر حفظ المرتجع")}</div> : null}
        </CardContent>
      </Card>
    </div>
  )
}
