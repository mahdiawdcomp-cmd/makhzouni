import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Banknote, Barcode, Minus, Plus, Search, Trash2, UserRound, X } from "lucide-react"
import { createInvoice, getCustomers, getProducts } from "../api/endpoints"
import { Input } from "../components/ui/input"
import type { Customer, Product } from "../types/api"
import { fmt } from "../utils/fmt"
import { cn } from "../utils/cn"
import { apiErrorMessage } from "../utils/apiError"

type PosUnit = "PIECE" | "DOZEN" | "CARTON"
type PosItem = {
  lineId: string
  productId: string
  name: string
  unit: PosUnit
  quantity: number
  unitPrice: number
}

function normalize(value: string | undefined | null) {
  return String(value ?? "").trim().toLowerCase()
}

function productMatches(product: Product, query: string) {
  const q = normalize(query)
  if (!q) return true
  return [product.name, product.itemNumber, product.qrCode ?? "", product.cartonQrCode ?? ""].some(
    (v) => normalize(v).includes(q),
  )
}

function detectUnit(product: Product, code: string): PosUnit {
  if (code && product.cartonQrCode && normalize(code) === normalize(product.cartonQrCode)) return "CARTON"
  return "PIECE"
}

function priceFor(product: Product, unit: PosUnit) {
  if (unit === "CARTON") return Number(product.salePrice) * Number(product.pcsPerCarton || 1)
  if (unit === "DOZEN") return Number(product.salePrice) * 12
  return Number(product.salePrice)
}

export function POSPage() {
  const queryClient = useQueryClient()
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const paidInputRef = useRef<HTMLInputElement>(null)
  const clientRequestIdRef = useRef(crypto.randomUUID())

  const [customerQuery, setCustomerQuery] = useState("")
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [productQuery, setProductQuery] = useState("")
  const [items, setItems] = useState<PosItem[]>([])
  const [paid, setPaid] = useState("")
  const [message, setMessage] = useState("")
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)

  const { data: customers = [] } = useQuery({
    queryKey: ["customers", "pos"],
    queryFn: () => getCustomers({ limit: 200 }),
  })
  const { data: products = [] } = useQuery({
    queryKey: ["products", "pos"],
    queryFn: () => getProducts({ limit: 300 }),
  })

  const customerSuggestions = useMemo(() => {
    const q = normalize(customerQuery)
    if (!q) return customers.slice(0, 12)
    return customers
      .filter((c) => normalize(c.name).includes(q) || normalize(c.phone).includes(q))
      .slice(0, 12)
  }, [customers, customerQuery])

  const filteredProducts = useMemo(
    () => products.filter((p) => productMatches(p, productQuery)).slice(0, 80),
    [products, productQuery],
  )

  const subtotal = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
  const paidValue = Number(paid || 0)
  const remaining = Math.max(subtotal - paidValue, 0)
  const change = Math.max(paidValue - subtotal, 0)

  function chooseCustomer(c: Customer) {
    setSelectedCustomer(c)
    setCustomerQuery(c.name)
    setShowCustomerPicker(false)
    setTimeout(() => barcodeInputRef.current?.focus(), 0)
  }

  function addProduct(product: Product, preferredCode = productQuery) {
    const unit = detectUnit(product, preferredCode)
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id && i.unit === unit)
      if (existing) {
        return prev.map((i) => (i.lineId === existing.lineId ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [
        ...prev,
        {
          lineId: crypto.randomUUID(),
          productId: product.id,
          name: product.name,
          unit,
          quantity: 1,
          unitPrice: priceFor(product, unit),
        },
      ]
    })
    setProductQuery("")
    setMessage("")
    setTimeout(() => barcodeInputRef.current?.focus(), 0)
  }

  function addBySearch() {
    const q = normalize(productQuery)
    if (!q) return
    const exact = products.find((p) =>
      [p.qrCode, p.cartonQrCode, p.itemNumber].some((v) => v && normalize(v) === q),
    )
    if (exact) addProduct(exact, productQuery)
    else if (filteredProducts.length > 0) addProduct(filteredProducts[0])
  }

  function adjustQty(lineId: string, delta: number) {
    setItems((prev) =>
      prev
        .map((i) => (i.lineId === lineId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    )
  }

  function handleBarcodeKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      addBySearch()
    }
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      createInvoice({
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
      setMessage(`✓ فاتورة ${response.data?.invoiceNumber ?? ""} — تم الحفظ`)
      setItems([])
      setPaid("")
      setProductQuery("")
      clientRequestIdRef.current = crypto.randomUUID()
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["products"] })
      void queryClient.invalidateQueries({ queryKey: ["customers"] })
      setTimeout(() => barcodeInputRef.current?.focus(), 0)
    },
    onError: () => {
      clientRequestIdRef.current = crypto.randomUUID()
    },
  })

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        if (selectedCustomer && items.length > 0 && !saveMutation.isPending) saveMutation.mutate()
      }
      if (event.key === "F8") {
        event.preventDefault()
        paidInputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [selectedCustomer, items, saveMutation])

  const canSave = !!selectedCustomer && items.length > 0 && !saveMutation.isPending

  // Quick-pay amounts: exact, nearest 1000, nearest 5000
  const quickAmounts = [...new Set([
    subtotal,
    Math.ceil(subtotal / 1000) * 1000,
    Math.ceil(subtotal / 5000) * 5000,
  ])].filter((v) => v > 0)

  return (
    <div className="flex h-full flex-col gap-2" dir="rtl">
      {/* Top bar: barcode + customer */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Barcode className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            ref={barcodeInputRef}
            className="pr-9 text-base"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            onKeyDown={handleBarcodeKey}
            placeholder="باركود أو اسم المادة — Enter للإضافة"
            autoFocus
          />
        </div>
        {productQuery && (
          <button
            type="button"
            onClick={addBySearch}
            className="rounded-lg bg-emerald-600 px-4 py-2 font-bold text-white hover:bg-emerald-700 active:scale-95"
          >
            إضافة
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowCustomerPicker(true)}
          className={cn(
            "flex min-w-36 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
            selectedCustomer
              ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900",
          )}
        >
          <UserRound className="h-4 w-4 shrink-0" />
          <span className="truncate font-semibold">{selectedCustomer?.name ?? "اختر الزبون"}</span>
        </button>
      </div>

      {/* Main: products grid + cart */}
      <div className="flex min-h-0 flex-1 gap-2">
        {/* ── Products Grid ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {productQuery ? (
            <div className="shrink-0 flex items-center gap-2 border-b px-3 py-1.5 text-xs text-slate-500 dark:border-slate-700">
              <Search className="h-3 w-3" />
              {filteredProducts.length} نتيجة
              <button
                type="button"
                onClick={() => setProductQuery("")}
                className="mr-auto text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          <div className="grid min-h-0 flex-1 auto-rows-max gap-1.5 overflow-y-auto p-1.5 grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                className="flex flex-col items-center justify-between rounded-xl border-2 border-transparent bg-slate-50 p-2 text-center transition active:scale-95 hover:border-emerald-400 hover:bg-emerald-50 dark:bg-slate-800 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30"
                style={{ minHeight: "84px" }}
              >
                <span className="line-clamp-2 w-full text-xs font-bold leading-tight text-slate-800 dark:text-slate-100">
                  {product.name}
                </span>
                <div className="mt-1 flex flex-col items-center gap-0.5">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                    {fmt(product.salePrice)}
                  </span>
                  {Number(product.currentStock) <= 0 ? (
                    <span className="text-[9px] text-rose-500 font-semibold">نفد</span>
                  ) : (
                    <span className="text-[9px] text-slate-400">{fmt(product.currentStock)} قطعة</span>
                  )}
                </div>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <div className="col-span-full py-16 text-center text-slate-400">لا توجد مواد مطابقة</div>
            )}
          </div>
        </div>

        {/* ── Cart / Receipt ── */}
        <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:w-72 xl:w-80">
          {/* Cart header */}
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 dark:border-slate-700">
            <span className="font-bold">الكاشير</span>
            {items.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold dark:bg-slate-800">
                {items.length}
              </span>
            )}
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => setItems([])}
                className="mr-auto text-xs text-slate-400 hover:text-rose-600"
              >
                مسح الكل
              </button>
            )}
          </div>

          {/* Cart items */}
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            {items.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">اضغط على مادة لإضافتها</div>
            ) : (
              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.lineId}
                    className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold leading-tight">{item.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {fmt(item.unitPrice)} ×{" "}
                        <span className="font-semibold text-slate-700 dark:text-slate-200">
                          {fmt(item.quantity * item.unitPrice)}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => adjustQty(item.lineId, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-700 active:bg-rose-100 dark:bg-slate-700 dark:text-slate-200"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-sm font-bold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => adjustQty(item.lineId, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 active:bg-emerald-200 dark:bg-emerald-900/50 dark:text-emerald-300"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustQty(item.lineId, -item.quantity)}
                        className="flex h-7 w-7 items-center justify-center rounded-full text-slate-300 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Payment section */}
          <div className="shrink-0 space-y-2 border-t p-3 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">الإجمالي</span>
              <span className="text-xl font-bold">{fmt(subtotal)}</span>
            </div>

            <Input
              ref={paidInputRef}
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              type="number"
              placeholder="المبلغ المدفوع (F8)"
              className="text-center text-base font-bold"
              inputMode="numeric"
              onFocus={(e) => e.target.select()}
            />

            {/* Quick pay buttons */}
            {subtotal > 0 && (
              <div className="grid grid-cols-3 gap-1">
                {quickAmounts.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setPaid(String(amount))}
                    className="rounded-lg bg-slate-100 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 active:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {fmt(amount)}
                  </button>
                ))}
              </div>
            )}

            {remaining > 0 && (
              <div className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-1.5 text-sm dark:bg-amber-950/30">
                <span className="text-slate-500">باقي</span>
                <span className="font-bold text-amber-700 dark:text-amber-400">{fmt(remaining)}</span>
              </div>
            )}
            {change > 0 && (
              <div className="flex items-center justify-between rounded-md bg-emerald-50 px-3 py-1.5 text-sm dark:bg-emerald-950/30">
                <span className="text-slate-500">راجع</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">{fmt(change)}</span>
              </div>
            )}

            <button
              type="button"
              disabled={!canSave}
              onClick={() => saveMutation.mutate()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-bold text-white shadow transition active:scale-[.98] disabled:opacity-40 hover:bg-emerald-700"
            >
              <Banknote className="h-5 w-5" />
              {saveMutation.isPending ? "جاري الحفظ..." : "حفظ البيع"}
            </button>

            {!selectedCustomer && (
              <p className="text-center text-xs text-amber-600">اختر الزبون أولاً</p>
            )}

            <p className="text-center text-[10px] text-slate-400">Ctrl+S حفظ | F8 المبلغ | Esc خروج</p>

            {message && (
              <div className="rounded-md bg-emerald-50 p-2 text-center text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                {message}
              </div>
            )}
            {saveMutation.isError && (
              <div className="rounded-md bg-rose-50 p-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {apiErrorMessage(saveMutation.error, "تعذر حفظ البيع")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Customer picker modal */}
      {showCustomerPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">اختر الزبون</h3>
              <button
                type="button"
                onClick={() => setShowCustomerPicker(false)}
                className="rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <Input
              autoFocus
              value={customerQuery}
              onChange={(e) => {
                setCustomerQuery(e.target.value)
                setSelectedCustomer(null)
              }}
              placeholder="اسم أو هاتف الزبون"
              className="mb-2"
            />
            <div className="max-h-72 space-y-1 overflow-auto">
              {customerSuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-right hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => chooseCustomer(c)}
                >
                  <span className="font-bold">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.phone}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
