import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Plus, RefreshCw, Save, Trash2, X, AlertTriangle } from "lucide-react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useInvoice } from "../hooks/useInvoices"
import { useProducts } from "../hooks/useProducts"
import { updateInvoice } from "../api/endpoints"
import { fmt } from "../utils/fmt"
import type { Product } from "../types/api"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { NumericInput } from "../components/ui/NumericInput"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { ErrorExplain } from "../components/ui/error-explain"
import { READ_ONLY_MESSAGE, useReadOnly } from "../hooks/useTenantConfig"
import { unitPriceFrom, unitToPieces, visibleUnits } from "../utils/units"

type Unit = "PIECE" | "DOZEN" | "BOX" | "CARTON"

interface EditItem {
  productId: string
  productName: string
  unit: Unit
  quantity: number
  unitPrice: number
  warehouseId?: string
  warehouseName?: string
  notes?: string
}

const UNIT_LABELS: Array<[Unit, string]> = [
  ["PIECE", "قطعة"],
  ["DOZEN", "درزن"],
  ["BOX", "علبة"],
  ["CARTON", "كرتونة"],
]

function fmtNumInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "")
  if (!digits) return ""
  return Number(digits).toLocaleString("en-US")
}

/**
 * Standalone, full-page invoice editor. Opens like the "new invoice" screen
 * (items listed in order, add/edit/remove freely, save or cancel) instead of a
 * cramped dialog. The date and invoice number stay fixed; the customer is shown
 * read-only. Uses the same proven updateInvoice mutation as before.
 */
export function InvoiceEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const readOnly = useReadOnly()

  const invoiceQuery = useInvoice(id)
  const invoice = invoiceQuery.data
  const { productsQuery } = useProducts()
  const allProducts = useMemo(() => productsQuery.data ?? [], [productsQuery.data])

  usePageTitle(invoice ? `تعديل الفاتورة ${invoice.invoiceNumber}` : "تعديل الفاتورة")

  const [ready, setReady] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [paid, setPaid] = useState("0")
  const [paymentType, setPaymentType] = useState<"CREDIT" | "CASH" | "PARTIAL">("CREDIT")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<EditItem[]>([])
  const [productSearch, setProductSearch] = useState("")
  const [productOpen, setProductOpen] = useState(false)

  // Initialize the form once, when both the invoice and products have loaded, so
  // stored per-line warehouse names resolve correctly.
  useEffect(() => {
    if (ready || !invoice) return
    setDiscount(Number(invoice.discount ?? 0))
    setPaid(Number(invoice.paidAmount ?? 0).toLocaleString("en-US"))
    setPaymentType((invoice.paymentType as "CREDIT" | "CASH" | "PARTIAL") ?? "CREDIT")
    setNotes(invoice.notes ?? "")
    setItems((invoice.items ?? []).map((it) => {
      const wsId = it.warehouseId
      const product = allProducts.find((p) => p.id === it.productId)
      const wsName = wsId
        ? product?.warehouseStocks?.find((ws) => ws.warehouseId === wsId)?.warehouse?.name
        : undefined
      return {
        productId: it.productId,
        productName: it.productName ?? it.productId,
        unit: (it.unit ?? "PIECE") as Unit,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        warehouseId: wsId,
        warehouseName: wsName,
        notes: it.notes ?? "",
      }
    }))
    setReady(true)
  }, [invoice, allProducts, ready])

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase()
    return allProducts
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.itemNumber.toLowerCase().includes(q))
      .slice(0, 15)
  }, [allProducts, productSearch])

  function addProduct(p: Product) {
    const isSale = invoice?.type === "SALE"
    let warehouseId: string | undefined
    let warehouseName: string | undefined
    if (isSale) {
      const shopStock = p.shopStock ?? 0
      if (shopStock === 0) {
        const best = (p.warehouseStocks ?? [])
          .filter((ws) => ws.quantityPieces > 0)
          .sort((a, b) => b.quantityPieces - a.quantityPieces)[0]
        if (best) {
          warehouseId = best.warehouseId
          warehouseName = best.warehouse?.name
        }
      }
    }
    setItems((prev) => [
      ...prev,
      {
        productId: p.id,
        productName: p.name,
        unit: "PIECE",
        quantity: 1,
        unitPrice: (invoice?.type === "PURCHASE" ? p.purchasePrice : p.salePrice) ?? 0,
        warehouseId,
        warehouseName,
      },
    ])
    setProductOpen(false)
    setProductSearch("")
  }

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
  const total = subtotal - (discount || 0)

  // PURCHASE guard: never let a purchase line be saved with a 0/blank price — that
  // silently zeroes the product's cost/purchase price through the weighted-average
  // recompute on the server. Block the save and force a real price to be entered.
  const missingPurchasePrice =
    invoice?.type === "PURCHASE" && items.some((it) => !(it.unitPrice > 0))

  // Employee warning (SALE only): best-effort projection of shop stock AFTER this
  // edit. The backend edit fully reverses the original lines then re-applies the
  // new ones, so projected = currentShopStock + originalPieces − newPieces.
  // This never blocks saving; a negative result is logged server-side for the
  // manager (audit log), NOT sent through the approval queue.
  const negativeStockWarnings = useMemo(() => {
    if (!invoice || invoice.type !== "SALE") return [] as string[]
    const pcsByProduct = (rows: Array<{ productId: string; unit: Unit; quantity: number }>) => {
      const acc: Record<string, number> = {}
      for (const it of rows) {
        const prod = allProducts.find((p) => p.id === it.productId)
        if (!prod) continue
        acc[it.productId] = (acc[it.productId] ?? 0) + unitToPieces(it.unit, it.quantity, prod)
      }
      return acc
    }
    const originalPcs = pcsByProduct(
      (invoice.items ?? []).map((it) => ({ productId: it.productId, unit: (it.unit ?? "PIECE") as Unit, quantity: it.quantity })),
    )
    const newPcs = pcsByProduct(items)
    const warnings: string[] = []
    const seen = new Set<string>()
    for (const it of items) {
      if (seen.has(it.productId)) continue
      seen.add(it.productId)
      const prod = allProducts.find((p) => p.id === it.productId)
      if (!prod) continue
      const shop = prod.shopStock ?? 0
      const projected = shop + (originalPcs[it.productId] ?? 0) - (newPcs[it.productId] ?? 0)
      if (projected < 0) warnings.push(`${it.productName} — سيصبح المحل ${projected} قطعة بعد التعديل`)
    }
    return warnings
  }, [invoice, allProducts, items])

  const mutation = useMutation({
    mutationFn: () =>
      updateInvoice(id!, {
        type: invoice?.type,
        customerId: invoice?.customerId ?? "",
        discount: discount || 0,
        tax: 0,
        paidAmount: Number(paid.replace(/,/g, "")),
        paymentType,
        notes: notes.trim() || undefined,
        items: items.map((it) => ({
          productId: it.productId,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          warehouseId: it.warehouseId,
          notes: it.notes?.trim() || undefined,
        })),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id, "audit-trail"] })
      navigate(`/invoices/${id}`)
    },
  })

  if (invoiceQuery.isLoading) return <div className="p-6 text-sm text-slate-500">جاري تحميل الفاتورة...</div>
  if (!invoice) return <div className="p-6 text-sm text-slate-500">الفاتورة غير موجودة.</div>

  const isSale = invoice.type === "SALE"
  const typeLabel = isSale ? "فاتورة بيع" : invoice.type === "PURCHASE" ? "فاتورة شراء" : "فاتورة"

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" className="px-0" onClick={() => navigate(`/invoices/${id}`)}>
          <ArrowRight className="h-4 w-4 ml-1" /> رجوع
        </Button>
      </div>

      <div className={`rounded-2xl p-4 text-white ${isSale ? "bg-emerald-600" : "bg-amber-600"}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">تعديل {typeLabel}</p>
            <p className="text-sm opacity-90">
              {invoice.invoiceNumber} · {invoice.customer?.name ?? "—"}
            </p>
          </div>
          <span className="rounded-lg bg-white/20 px-3 py-1 text-xs">التاريخ ورقم الفاتورة ثابتان</span>
        </div>
      </div>

      {/* Items */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">الأصناف ({items.length})</span>
          <Button size="sm" onClick={() => setProductOpen(true)}>
            <Plus className="h-4 w-4" /> أضف صنف
          </Button>
        </div>

        {productOpen ? (
          <div className="mb-3 rounded-lg border p-3 bg-slate-50 dark:bg-slate-900 dark:border-slate-700">
            <div className="mb-2 flex items-center gap-2">
              <Input
                autoFocus
                placeholder="بحث بالاسم أو رقم الصنف"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
              />
              <Button variant="ghost" size="sm" onClick={() => setProductOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-56 overflow-auto">
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="flex w-full justify-between rounded px-3 py-2 text-right text-sm hover:bg-white dark:hover:bg-slate-800"
                  onClick={() => addProduct(p)}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-slate-500">{p.itemNumber}</span>
                </button>
              ))}
              {filteredProducts.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-slate-400">لا نتائج</p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>الاسم</TH>
                <TH>الوحدة</TH>
                <TH>العدد</TH>
                <TH>السعر</TH>
                <TH>الإجمالي</TH>
                <TH>ملاحظة</TH>
                <TH>حذف</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((it, i) => (
                <TR key={i}>
                  <TD className="text-sm font-medium">
                    {it.productName}
                    {it.warehouseName ? (
                      <span className="block text-xs text-slate-500">📦 {it.warehouseName}</span>
                    ) : null}
                  </TD>
                  <TD>
                    <select
                      className="h-8 rounded border bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      value={it.unit}
                      onChange={(e) => {
                        const nextUnit = e.target.value as Unit
                        const product = allProducts.find((p) => p.id === it.productId)
                        setItems((p) => p.map((x, j) => {
                          if (j !== i) return x
                          // Re-derive the default price for the new unit (piece price × pieces in unit).
                          const base = product
                            ? (invoice?.type === "PURCHASE" ? product.purchasePrice : product.salePrice) ?? 0
                            : 0
                          return {
                            ...x,
                            unit: nextUnit,
                            unitPrice: product ? unitPriceFrom(base, nextUnit, product) : x.unitPrice,
                          }
                        }))
                      }}
                    >
                      {UNIT_LABELS.filter(([val]) => {
                        // Hidden units stay selectable only if this line already uses them.
                        if (val === it.unit) return true
                        const product = allProducts.find((p) => p.id === it.productId)
                        return product ? visibleUnits(product).includes(val) : true
                      }).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </TD>
                  <TD>
                    <NumericInput
                      decimal={false}
                      className="h-8 w-20 text-sm"
                      value={it.quantity}
                      onFocus={(e) => e.target.select()}
                      onValueChange={(n) =>
                        setItems((p) => p.map((x, j) => (j === i ? { ...x, quantity: n } : x)))
                      }
                    />
                  </TD>
                  <TD>
                    <NumericInput
                      className="h-8 w-24 text-sm"
                      value={it.unitPrice}
                      onFocus={(e) => e.target.select()}
                      onValueChange={(n) =>
                        setItems((p) => p.map((x, j) => (j === i ? { ...x, unitPrice: n } : x)))
                      }
                    />
                  </TD>
                  <TD>
                    <NumericInput
                      className="h-8 w-28 text-sm font-semibold"
                      value={Math.round(it.quantity * it.unitPrice)}
                      onFocus={(e) => e.target.select()}
                      onValueChange={(tot) => {
                        const qty = it.quantity || 1
                        setItems((p) =>
                          p.map((x, j) => (j === i ? { ...x, unitPrice: Math.round((tot / qty) * 1000) / 1000 } : x)),
                        )
                      }}
                    />
                  </TD>
                  <TD>
                    <Input
                      className="h-8 min-w-36 text-sm"
                      value={it.notes ?? ""}
                      placeholder="ملاحظة"
                      onChange={(e) =>
                        setItems((p) => p.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))
                      }
                    />
                  </TD>
                  <TD>
                    <Button variant="ghost" size="sm" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  </TD>
                </TR>
              ))}
              {items.length === 0 ? (
                <TR>
                  <TD colSpan={7} className="py-6 text-center text-sm text-slate-400">
                    لا يوجد أصناف — اضغط «أضف صنف»
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </div>
      </div>

      {/* Totals & payment */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3">
          <label className="mb-1 block text-xs text-slate-500">ملاحظات عامة للفاتورة</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات عامة (اختياري)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">الخصم</label>
            <NumericInput
              value={discount}
              onFocus={(e) => e.target.select()}
              onValueChange={(n) => setDiscount(n)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">المبلغ المدفوع</label>
            <Input
              inputMode="numeric"
              dir="ltr"
              value={paid}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setPaid(fmtNumInput(e.target.value))}
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs text-slate-500">طريقة الدفع</label>
          <div className="flex gap-2">
            {([["CASH", "نقد"], ["CREDIT", "آجل"], ["PARTIAL", "جزئي"]] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setPaymentType(val)}
                className={`flex-1 rounded-md border py-2 text-sm font-medium transition-colors ${
                  paymentType === val
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex justify-between rounded-lg bg-slate-50 p-3 text-base font-bold dark:bg-slate-950">
          <span>الإجمالي بعد التعديل</span>
          <span>{fmt(total)}</span>
        </div>
        {total < 0 ? (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4" /> الخصم أكبر من المجموع
          </div>
        ) : null}
        {negativeStockWarnings.length > 0 ? (
          <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" /> تنبيه: التعديل سيجعل المخزون سالباً
            </div>
            {negativeStockWarnings.map((w, i) => (
              <div key={i} className="mt-0.5 text-xs">• {w}</div>
            ))}
            <div className="mt-1 text-[11px] opacity-80">يمكنك الحفظ — سيُسجَّل تلقائياً لمراجعة المدير (بدون طلب موافقة).</div>
          </div>
        ) : null}
        {mutation.isError ? <ErrorExplain className="mt-3" error={mutation.error} fallback="تعذر تعديل الفاتورة" /> : null}
      </div>

      {/* Sticky action bar */}
      <div className="sticky inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        {missingPurchasePrice ? (
          <div className="mx-auto mb-2 max-w-5xl rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            أدخل سعر شراء صحيح (أكبر من صفر) لكل مادة قبل الحفظ — لا يمكن حفظ سطر شراء بسعر صفر.
          </div>
        ) : null}
        <div className="mx-auto flex max-w-5xl gap-2">
          <Button variant="outline" className="flex-1" onClick={() => navigate(`/invoices/${id}`)}>
            إلغاء
          </Button>
          <Button
            className="flex-1"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || items.length === 0 || total < 0 || readOnly || missingPurchasePrice}
            title={readOnly ? READ_ONLY_MESSAGE : missingPurchasePrice ? "أدخل سعر شراء صحيح لكل مادة قبل الحفظ" : undefined}
          >
            {mutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
            حفظ التعديلات
          </Button>
        </div>
      </div>
    </div>
  )
}

export default InvoiceEditPage
