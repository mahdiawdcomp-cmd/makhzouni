import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Barcode, Banknote, Receipt, Search, Trash2 } from "lucide-react"
import { createInvoice, getCustomers, getProducts } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import type { Customer, Product } from "../types/api"
import { fmt } from "../utils/fmt"

type PosItem = {
  lineId: string
  productId: string
  name: string
  unit: "PIECE" | "CARTON"
  quantity: number
  unitPrice: number
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function productMatches(product: Product, query: string) {
  const q = normalize(query)
  if (!q) return true
  return [
    product.name,
    product.itemNumber,
    product.qrCode ?? "",
    product.cartonQrCode ?? "",
  ].some((value) => normalize(value).includes(q))
}

function detectUnit(product: Product, code: string): "PIECE" | "CARTON" {
  return code && product.cartonQrCode && normalize(code) === normalize(product.cartonQrCode)
    ? "CARTON"
    : "PIECE"
}

function priceFor(product: Product, unit: "PIECE" | "CARTON") {
  return unit === "CARTON" ? Number(product.salePrice) * Number(product.pcsPerCarton || 1) : Number(product.salePrice)
}

export function POSPage() {
  const queryClient = useQueryClient()
  const searchRef = useRef<HTMLInputElement>(null)
  const clientRequestIdRef = useRef(crypto.randomUUID())
  const [customerQuery, setCustomerQuery] = useState("")
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerHighlight, setCustomerHighlight] = useState(0)
  const [productQuery, setProductQuery] = useState("")
  const [productHighlight, setProductHighlight] = useState(0)
  const [items, setItems] = useState<PosItem[]>([])
  const [paid, setPaid] = useState("")
  const [message, setMessage] = useState("")

  const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: () => getCustomers() })
  const { data: products = [] } = useQuery({ queryKey: ["products"], queryFn: () => getProducts() })

  const customerSuggestions = useMemo(() => {
    const q = normalize(customerQuery)
    if (!q) return customers.slice(0, 8)
    return customers
      .filter((customer) => normalize(customer.name).includes(q) || normalize(customer.phone).includes(q))
      .slice(0, 8)
  }, [customers, customerQuery])

  const productSuggestions = useMemo(
    () => products.filter((product) => productMatches(product, productQuery)).slice(0, 12),
    [products, productQuery],
  )

  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const paidValue = Number(paid || 0)
  const remaining = Math.max(subtotal - paidValue, 0)
  const change = Math.max(paidValue - subtotal, 0)

  function addProduct(product: Product, preferredCode = productQuery) {
    const unit = detectUnit(product, preferredCode)
    setItems((prev) => [
      ...prev,
      {
        lineId: crypto.randomUUID(),
        productId: product.id,
        name: product.name,
        unit,
        quantity: 1,
        unitPrice: priceFor(product, unit),
      },
    ])
    setProductQuery("")
    setProductHighlight(0)
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  function addBySearch() {
    const q = normalize(productQuery)
    if (!q) return
    const exact = products.find((product) =>
      [product.qrCode, product.cartonQrCode, product.itemNumber].some((value) => value && normalize(value) === q)
    )
    if (exact) addProduct(exact, productQuery)
    else if (productSuggestions.length > 0) addProduct(productSuggestions[productHighlight] ?? productSuggestions[0])
  }

  function handleProductKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setProductHighlight((i) => Math.min(i + 1, Math.max(productSuggestions.length - 1, 0)))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setProductHighlight((i) => Math.max(i - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      addBySearch()
    }
  }

  function chooseCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setCustomerQuery(customer.name)
    setCustomerHighlight(0)
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const saveMutation = useMutation({
    mutationFn: () => createInvoice({
      customerId: selectedCustomer?.id ?? "",
      type: "SALE",
      clientRequestId: clientRequestIdRef.current,
      discount: 0,
      tax: 0,
      paidAmount: paidValue,
      paymentType: remaining <= 0 ? "CASH" : paidValue > 0 ? "PARTIAL" : "CREDIT",
      items: items.map((item) => ({
        productId: item.productId,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    }),
    onSuccess: (response) => {
      setMessage(`تم حفظ الفاتورة ${response.data?.invoiceNumber ?? ""}`)
      setItems([])
      setPaid("")
      setProductQuery("")
      clientRequestIdRef.current = crypto.randomUUID()
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["products"] })
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
      setTimeout(() => searchRef.current?.focus(), 0)
    },
  })

  // Ctrl+S → checkout (save invoice) when ready
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        if (selectedCustomer && items.length > 0 && !saveMutation.isPending) {
          saveMutation.mutate()
        }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [selectedCustomer, items, saveMutation])

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Card className="border-t-4 border-t-emerald-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Barcode className="h-4 w-4 text-emerald-600" />
              نقطة البيع السريعة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">الزبون</label>
                <Input
                  value={customerQuery}
                  onChange={(event) => {
                    setCustomerQuery(event.target.value)
                    setSelectedCustomer(null)
                    setCustomerHighlight(0)
                  }}
                  onKeyDown={(event) => {
                    if (!customerSuggestions.length) return
                    if (event.key === "ArrowDown") {
                      event.preventDefault()
                      setCustomerHighlight((i) => Math.min(i + 1, customerSuggestions.length - 1))
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault()
                      setCustomerHighlight((i) => Math.max(i - 1, 0))
                    } else if (event.key === "Enter") {
                      event.preventDefault()
                      chooseCustomer(customerSuggestions[customerHighlight] ?? customerSuggestions[0])
                    }
                  }}
                  placeholder="اكتب اسم أو هاتف الزبون"
                />
                {!selectedCustomer && customerQuery ? (
                  <div className="mt-1 max-h-44 overflow-auto rounded-md border bg-white shadow-sm">
                    {customerSuggestions.map((customer, index) => (
                      <button
                        key={customer.id}
                        type="button"
                        className={`flex w-full items-center justify-between px-3 py-2 text-right text-sm hover:bg-slate-50 ${index === customerHighlight ? "bg-slate-100" : ""}`}
                        onClick={() => chooseCustomer(customer)}
                      >
                        <span className="font-medium">{customer.name}</span>
                        <span className="text-xs text-slate-500">{customer.phone}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-500">مسح باركود أو بحث مادة</label>
                <div className="flex gap-2">
                  <Input
                    ref={searchRef}
                    value={productQuery}
                    onChange={(event) => {
                      setProductQuery(event.target.value)
                      setProductHighlight(0)
                    }}
                    onKeyDown={handleProductKey}
                    placeholder="امسح الباركود أو اكتب اسم المادة"
                  />
                  <Button type="button" onClick={addBySearch}>
                    <Search className="h-4 w-4" />
                    إضافة
                  </Button>
                </div>
                {productQuery ? (
                  <div className="mt-1 grid max-h-56 gap-1 overflow-auto rounded-md border bg-white p-1 shadow-sm md:grid-cols-2">
                    {productSuggestions.map((product, index) => (
                      <button
                        key={product.id}
                        type="button"
                        className={`rounded-md px-3 py-2 text-right hover:bg-emerald-50 ${index === productHighlight ? "bg-emerald-50" : ""}`}
                        onClick={() => addProduct(product)}
                      >
                        <div className="font-semibold">{product.name}</div>
                        <div className="text-xs text-slate-500">
                          {product.itemNumber} | السعر {fmt(product.salePrice)} | الرصيد {fmt(product.currentStock)}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-sky-500">
          <CardHeader>
            <CardTitle>مواد الفاتورة</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>المادة</TH>
                  <TH>الوحدة</TH>
                  <TH>العدد</TH>
                  <TH>السعر</TH>
                  <TH>المجموع</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.lineId} className="border-r-4 border-sky-300">
                    <TD className="font-semibold">{item.name}</TD>
                    <TD>
                      <select
                        className="h-8 rounded-md border bg-white px-2 text-sm"
                        value={item.unit}
                        onChange={(event) => setItems((prev) => prev.map((row) =>
                          row.lineId === item.lineId
                            ? {
                              ...row,
                              unit: event.target.value as "PIECE" | "CARTON",
                              unitPrice: priceFor(
                                products.find((product) => product.id === row.productId) ?? ({
                                  salePrice: row.unitPrice,
                                  pcsPerCarton: 1,
                                } as Product),
                                event.target.value as "PIECE" | "CARTON",
                              ),
                            }
                            : row
                        ))}
                      >
                        <option value="PIECE">قطعة</option>
                        <option value="CARTON">كارتون</option>
                      </select>
                    </TD>
                    <TD>
                      <Input
                        className="w-20"
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(event) => setItems((prev) => prev.map((row) =>
                          row.lineId === item.lineId ? { ...row, quantity: Number(event.target.value || 1) } : row
                        ))}
                      />
                    </TD>
                    <TD>
                      <Input
                        className="w-28"
                        type="number"
                        value={item.unitPrice}
                        onChange={(event) => setItems((prev) => prev.map((row) =>
                          row.lineId === item.lineId ? { ...row, unitPrice: Number(event.target.value || 0) } : row
                        ))}
                      />
                    </TD>
                    <TD className="font-bold">{fmt(item.quantity * item.unitPrice)}</TD>
                    <TD>
                      <Button variant="ghost" size="icon" onClick={() => setItems((prev) => prev.filter((row) => row.lineId !== item.lineId))}>
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </TD>
                  </TR>
                ))}
                {items.length === 0 ? (
                  <TR>
                    <TD colSpan={6} className="py-10 text-center text-slate-400">
                      امسح باركود أو ابحث عن مادة حتى تبدأ البيع
                    </TD>
                  </TR>
                ) : null}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit border-t-4 border-t-amber-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-amber-600" />
            ملخص الكاشير
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="text-slate-500">الزبون</div>
            <div className="font-bold">{selectedCustomer?.name ?? "لم يتم الاختيار"}</div>
          </div>
          <div className="space-y-2 text-sm">
            <Summary label="الإجمالي" value={subtotal} />
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">المبلغ المدفوع</label>
              <Input value={paid} onChange={(event) => setPaid(event.target.value)} type="number" placeholder="0" />
            </div>
            <Summary label="الباقي على الزبون" value={remaining} danger={remaining > 0} />
            <Summary label="راجع للزبون" value={change} good={change > 0} />
          </div>
          <Button
            className="h-11 w-full text-base"
            disabled={!selectedCustomer || items.length === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Banknote className="h-5 w-5" />
            حفظ البيع
          </Button>
          {message ? <div className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">{message}</div> : null}
          {saveMutation.isError ? (
            <div className="rounded-md bg-rose-50 p-2 text-sm text-rose-700">
              {saveMutation.error instanceof Error ? saveMutation.error.message : "تعذر حفظ البيع"}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function Summary({ label, value, danger, good }: { label: string; value: number; danger?: boolean; good?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-white px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className={danger ? "font-bold text-rose-600" : good ? "font-bold text-emerald-600" : "font-bold"}>
        {fmt(value)}
      </span>
    </div>
  )
}
