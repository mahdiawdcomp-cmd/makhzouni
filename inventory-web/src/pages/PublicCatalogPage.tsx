import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react"
import { getPublicCatalogProducts, submitPublicCatalogOrder } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import type { PublicCatalogProduct } from "../types/api"

type CartLine = {
  product: PublicCatalogProduct
  quantity: number
}

function money(value: number) {
  return new Intl.NumberFormat("ar-IQ").format(Math.round(value))
}

export function PublicCatalogPage() {
  const productsQuery = useQuery({
    queryKey: ["public-catalog-products"],
    queryFn: getPublicCatalogProducts,
  })
  const [search, setSearch] = useState("")
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerName, setCustomerName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [notes, setNotes] = useState("")
  const [submittedId, setSubmittedId] = useState<string | null>(null)

  const products = productsQuery.data ?? []
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter((product) =>
      [product.name, product.itemNumber, product.category ?? ""].some((value) => value.toLowerCase().includes(q)),
    )
  }, [products, search])

  const subtotal = cart.reduce((sum, line) => sum + line.quantity * line.product.salePrice, 0)
  const canSubmit = customerName.trim().length >= 2 && phone.trim().length >= 5 && cart.length > 0

  const orderMutation = useMutation({
    mutationFn: () =>
      submitPublicCatalogOrder({
        customerName: customerName.trim(),
        phone: phone.trim(),
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        items: cart.map((line) => ({
          productId: line.product.id,
          unit: "PIECE",
          quantity: line.quantity,
        })),
      }),
    onSuccess: (response) => {
      setSubmittedId(response.data?.approvalId ?? "ok")
      setCart([])
      setCustomerName("")
      setPhone("")
      setAddress("")
      setNotes("")
    },
  })

  function addProduct(product: PublicCatalogProduct) {
    setSubmittedId(null)
    setCart((prev) => {
      const current = prev.find((line) => line.product.id === product.id)
      if (current) {
        return prev.map((line) =>
          line.product.id === product.id
            ? { ...line, quantity: Math.min(line.quantity + 1, product.currentStock) }
            : line,
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((line) =>
          line.product.id === productId
            ? { ...line, quantity: Math.max(1, Math.min(line.product.currentStock, line.quantity + delta)) }
            : line,
        )
        .filter((line) => line.quantity > 0),
    )
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((line) => line.product.id !== productId))
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir="rtl">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">كتالوج المنتجات</h1>
            <p className="text-sm text-slate-500">اختر المواد وأرسل الطلب للمراجعة.</p>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            <ShoppingCart className="h-4 w-4" />
            {cart.length} مادة في السلة
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[1fr_360px]">
        <section className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pr-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث باسم المادة أو الرمز أو الصنف"
            />
          </div>

          {productsQuery.isLoading ? (
            <div className="rounded-md border border-dashed bg-white p-8 text-center text-sm text-slate-500">جاري تحميل المنتجات...</div>
          ) : null}
          {!productsQuery.isLoading && visibleProducts.length === 0 ? (
            <div className="rounded-md border border-dashed bg-white p-8 text-center text-sm text-slate-500">لا توجد مواد متوفرة مطابقة للبحث.</div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleProducts.map((product) => (
              <Card key={product.id} className="overflow-hidden">
                <div className="aspect-[4/3] bg-slate-100">
                  {product.imageUrl ? (
                    <img className="h-full w-full object-cover" src={product.imageUrl} alt={product.name} loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">بدون صورة</div>
                  )}
                </div>
                <CardContent className="space-y-3 p-4">
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-bold leading-6">{product.name}</h2>
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">{product.itemNumber}</span>
                    </div>
                    {product.category ? <p className="mt-1 text-xs text-slate-500">{product.category}</p> : null}
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-xs text-slate-500">سعر القطعة</p>
                      <p className="text-lg font-extrabold text-emerald-700">{money(product.salePrice)} د.ع</p>
                    </div>
                    <p className="text-xs text-slate-500">المتوفر: {money(product.currentStock)}</p>
                  </div>
                  <Button className="w-full" onClick={() => addProduct(product)}>أضف للسلة</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader><CardTitle>السلة</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {cart.length === 0 ? <p className="text-sm text-slate-500">السلة فارغة.</p> : null}
              {cart.map((line) => (
                <div key={line.product.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{line.product.name}</p>
                      <p className="text-xs text-slate-500">{money(line.product.salePrice)} د.ع للقطعة</p>
                    </div>
                    <button className="text-rose-500" onClick={() => removeLine(line.product.id)} aria-label="حذف من السلة">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center rounded-md border">
                      <button className="p-2" onClick={() => changeQuantity(line.product.id, -1)} aria-label="تقليل">
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="min-w-10 text-center font-bold">{line.quantity}</span>
                      <button className="p-2" onClick={() => changeQuantity(line.product.id, 1)} aria-label="زيادة">
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="font-bold">{money(line.quantity * line.product.salePrice)} د.ع</p>
                  </div>
                </div>
              ))}
              <div className="flex justify-between border-t pt-3 text-lg font-extrabold">
                <span>المجموع</span>
                <span>{money(subtotal)} د.ع</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>معلومات الطلب</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="اسم الزبون" />
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="رقم الهاتف" />
              <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="العنوان (اختياري)" />
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات (اختياري)" />
              <Button className="w-full" disabled={!canSubmit || orderMutation.isPending} onClick={() => orderMutation.mutate()}>
                {orderMutation.isPending ? "جاري الإرسال..." : "إرسال الطلب"}
              </Button>
              {submittedId ? (
                <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  تم إرسال الطلب، ينتظر موافقة الإدارة.
                </div>
              ) : null}
              {orderMutation.isError ? (
                <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
                  {orderMutation.error instanceof Error ? orderMutation.error.message : "تعذر إرسال الطلب"}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  )
}
