import { useRef, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RotateCcw, Search } from "lucide-react"
import { createInvoice, getCustomers, getLastSoldPrice, getProducts } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { apiErrorMessage } from "../utils/apiError"
import { UNIT_LABELS, piecesPerUnit, visibleUnits, type InvoiceUnit } from "../utils/units"

const ALL_UNITS: InvoiceUnit[] = ["PIECE", "DOZEN", "BOX", "CARTON"]

function isInvoiceUnit(value: string): value is InvoiceUnit {
  return (ALL_UNITS as string[]).includes(value)
}

function money(value: number) {
  return new Intl.NumberFormat("ar-IQ").format(Math.round(value))
}

export function SalesReturnsPage() {
  usePageTitle("مرتجع المبيعات")
  const queryClient = useQueryClient()
  const clientRequestIdRef = useRef(crypto.randomUUID())
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: () => getCustomers({ limit: 100 }) })
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: () => getProducts({ limit: 100 }) })
  const [customerId, setCustomerId] = useState("")
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [unit, setUnit] = useState<InvoiceUnit>("PIECE")
  const [unitPrice, setUnitPrice] = useState(0)
  const [originalInvoiceId, setOriginalInvoiceId] = useState<string | undefined>()
  const [warehouseId, setWarehouseId] = useState<string | undefined>()
  const [lastPriceNote, setLastPriceNote] = useState("")

  const selectedProduct = (productsQuery.data ?? []).find((p) => p.id === productId)
  // Units offered: the product's visible set, plus whatever unit the original
  // sale used — a soft-hidden unit must still be returnable.
  const unitOptions = selectedProduct
    ? Array.from(new Set([...visibleUnits(selectedProduct), unit]))
    : [unit]
  const piecesInUnit = selectedProduct ? piecesPerUnit(unit, selectedProduct) : 1

  const total = Math.max(0, quantity * unitPrice)
  const lastPriceMutation = useMutation({
    mutationFn: () => getLastSoldPrice(customerId, productId),
    onSuccess: (result) => {
      if (result) {
        // The price is per-UNIT, so the unit must travel with it. Sending a
        // carton price on a PIECE line would restock 1 piece and credit the
        // customer a full carton.
        const soldUnit = isInvoiceUnit(result.unit) ? result.unit : "PIECE"
        setUnit(soldUnit)
        setUnitPrice(result.unitPrice)
        setOriginalInvoiceId(result.invoiceId)
        setWarehouseId(result.warehouseId ?? undefined)
        setLastPriceNote(
          `آخر بيع: ${result.invoiceNumber} — ${money(result.unitPrice)} لكل ${UNIT_LABELS[soldUnit]}`,
        )
      } else {
        setLastPriceNote("ماكو بيع سابق لهذه المادة عند هذا الزبون.")
      }
    },
  })
  const createMutation = useMutation({
    mutationFn: () =>
      createInvoice({
        customerId,
        type: "SALES_RETURN",
        clientRequestId: clientRequestIdRef.current,
        originalInvoiceId,
        discount: 0,
        tax: 0,
        paidAmount: 0,
        paymentType: "CREDIT",
        items: [{ productId, warehouseId, unit, quantity, unitPrice }],
      }),
    onSuccess: () => {
      clientRequestIdRef.current = crypto.randomUUID()
      setProductId(""); setQuantity(1); setUnit("PIECE"); setUnitPrice(0); setOriginalInvoiceId(undefined); setWarehouseId(undefined); setLastPriceNote("")
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
    },
    onError: () => {
      clientRequestIdRef.current = crypto.randomUUID()
    },
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">مرتجع مبيعات</h1>
        <p className="text-slate-500">يرجع المخزون وينقص حساب الزبون بنفس سعر آخر بيع.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>فاتورة مرتجع</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <select className="h-10 rounded-md border px-3 text-sm" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">اختر الزبون</option>
              {(customersQuery.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="h-10 rounded-md border px-3 text-sm" value={productId} onChange={(e) => { setProductId(e.target.value); setUnit("PIECE"); setUnitPrice(0); setOriginalInvoiceId(undefined); setWarehouseId(undefined); setLastPriceNote("") }}>
              <option value="">اختر المادة</option>
              {(productsQuery.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!customerId || !productId || lastPriceMutation.isPending} onClick={() => lastPriceMutation.mutate()}>
              <Search className="h-4 w-4" /> آخر سعر بيع
            </Button>
            {lastPriceNote ? <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{lastPriceNote}</div> : null}
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} placeholder="العدد" />
            <select
              className="h-10 rounded-md border px-3 text-sm"
              value={unit}
              disabled={!productId}
              onChange={(e) => { if (isInvoiceUnit(e.target.value)) setUnit(e.target.value) }}
            >
              {unitOptions.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
            </select>
            <Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} placeholder={`سعر الإرجاع لكل ${UNIT_LABELS[unit]}`} />
            <div className="rounded-md border bg-slate-50 px-3 py-2 font-bold">المجموع: {money(total)}</div>
          </div>
          {productId && piecesInUnit > 1 ? (
            <div className="text-sm text-slate-500">
              يرجع للمخزن: {money(quantity * piecesInUnit)} قطعة ({quantity} × {piecesInUnit})
            </div>
          ) : null}
          <Button disabled={!customerId || !productId || quantity <= 0 || unitPrice < 0 || createMutation.isPending} onClick={() => createMutation.mutate()}>
            <RotateCcw className="h-4 w-4" /> حفظ مرتجع المبيعات
          </Button>
          {createMutation.isSuccess ? <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">تم حفظ المرتجع وتحديث المخزون والحساب.</div> : null}
          {createMutation.isError ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{apiErrorMessage(createMutation.error, "تعذر حفظ المرتجع")}</div> : null}
        </CardContent>
      </Card>
    </div>
  )
}
