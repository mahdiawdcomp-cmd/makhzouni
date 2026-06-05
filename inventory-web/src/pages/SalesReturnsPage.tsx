import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RotateCcw, Search } from "lucide-react"
import { createInvoice, getCustomers, getLastSoldPrice, getProducts } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"

function money(value: number) {
  return new Intl.NumberFormat("ar-IQ").format(Math.round(value))
}

export function SalesReturnsPage() {
  const queryClient = useQueryClient()
  const customersQuery = useQuery({ queryKey: ["customers"], queryFn: () => getCustomers({ limit: 100 }) })
  const productsQuery = useQuery({ queryKey: ["products"], queryFn: () => getProducts({ limit: 100 }) })
  const [customerId, setCustomerId] = useState("")
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState(0)
  const [originalInvoiceId, setOriginalInvoiceId] = useState<string | undefined>()
  const [lastPriceNote, setLastPriceNote] = useState("")

  const total = Math.max(0, quantity * unitPrice)
  const lastPriceMutation = useMutation({
    mutationFn: () => getLastSoldPrice(customerId, productId),
    onSuccess: (result) => {
      if (result) {
        setUnitPrice(result.unitPrice)
        setOriginalInvoiceId(result.invoiceId)
        setLastPriceNote(`آخر بيع: ${result.invoiceNumber} بسعر ${money(result.unitPrice)}`)
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
        originalInvoiceId,
        discount: 0,
        tax: 0,
        paidAmount: 0,
        paymentType: "CREDIT",
        items: [{ productId, unit: "PIECE", quantity, unitPrice }],
      }),
    onSuccess: () => {
      setProductId(""); setQuantity(1); setUnitPrice(0); setOriginalInvoiceId(undefined); setLastPriceNote("")
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
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
            <select className="h-10 rounded-md border px-3 text-sm" value={productId} onChange={(e) => { setProductId(e.target.value); setLastPriceNote("") }}>
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
          <div className="grid gap-3 md:grid-cols-3">
            <Input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} placeholder="العدد" />
            <Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(Number(e.target.value))} placeholder="سعر الإرجاع" />
            <div className="rounded-md border bg-slate-50 px-3 py-2 font-bold">المجموع: {money(total)}</div>
          </div>
          <Button disabled={!customerId || !productId || quantity <= 0 || unitPrice < 0 || createMutation.isPending} onClick={() => createMutation.mutate()}>
            <RotateCcw className="h-4 w-4" /> حفظ مرتجع المبيعات
          </Button>
          {createMutation.isSuccess ? <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">تم حفظ المرتجع وتحديث المخزون والحساب.</div> : null}
          {createMutation.isError ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{createMutation.error instanceof Error ? createMutation.error.message : "تعذر الحفظ"}</div> : null}
        </CardContent>
      </Card>
    </div>
  )
}
